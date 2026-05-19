const STORAGE_KEY = "nyc-pocket-ledger-v2";
const LEGACY_STORAGE_KEYS = ["budget_app_entries_v1", "budget-flow-transactions-v1"];
const KNOWN_SEED_MERCHANTS = new Set(["公司", "客户", "午饭", "超市", "保险"]);

const DEFAULT_CATEGORIES = {
  expense: [
    "房租水电",
    "地铁通勤",
    "外卖堂食",
    "买菜华超",
    "咖啡奶茶",
    "手机网费",
    "购物美妆",
    "医疗保险",
    "旅行",
    "订阅软件",
    "燃油",
    "汽车保险保养",
    "其他",
  ],
  income: [
    "主业收入",
    "副业收入",
    "奖金",
    "退税/报销",
    "现金收入",
    "投资利息",
    "二手转卖",
    "红包入账",
    "其他",
  ],
};

const CATEGORY_MIGRATION = {
  餐饮: "外卖堂食",
  超市: "买菜华超",
  交通: "地铁通勤",
  房租: "房租水电",
  水电网: "房租水电",
  购物: "购物美妆",
  娱乐: "其他",
  医疗: "医疗保险",
  订阅: "订阅软件",
  旅行: "旅行",
  转账收入: "现金收入",
  投资收益: "投资利息",
  Dining: "外卖堂食",
  Transit: "地铁通勤",
  Groceries: "买菜华超",
  "Rent & Utilities": "房租水电",
  Shopping: "购物美妆",
  Healthcare: "医疗保险",
  Travel: "旅行",
  Paycheck: "主业收入",
  Bonus: "奖金",
  Freelance: "副业收入",
  Investment: "投资利息",
  Refund: "退税/报销",
  工资: "主业收入",
  副业: "副业收入",
  理财: "投资利息",
  退款: "退税/报销",
};

const CHART_COLORS = [
  "#d46a3a",
  "#f0ad63",
  "#5d8f73",
  "#7f8fb2",
  "#cc7e6b",
  "#889f4b",
  "#6e80a6",
  "#c781a0",
];

const state = {
  transactions: [],
  selectedMonth: getCurrentMonth(),
  selectedYear: getCurrentYear(),
  viewMode: "month",
};

const elements = {
  heroBalance: document.querySelector("#heroBalance"),
  heroSummary: document.querySelector("#heroSummary"),
  periodBadge: document.querySelector("#periodBadge"),
  periodTitle: document.querySelector("#periodTitle"),
  periodSubtitle: document.querySelector("#periodSubtitle"),
  periodIncome: document.querySelector("#periodIncome"),
  periodExpense: document.querySelector("#periodExpense"),
  periodSavingRate: document.querySelector("#periodSavingRate"),
  entryCount: document.querySelector("#entryCount"),
  topCategory: document.querySelector("#topCategory"),
  topIncomeCategory: document.querySelector("#topIncomeCategory"),
  averageExpense: document.querySelector("#averageExpense"),
  lastTransactionTime: document.querySelector("#lastTransactionTime"),
  monthSelector: document.querySelector("#monthSelector"),
  yearSelector: document.querySelector("#yearSelector"),
  monthFilterWrap: document.querySelector("#monthFilterWrap"),
  yearFilterWrap: document.querySelector("#yearFilterWrap"),
  transactionList: document.querySelector("#transactionList"),
  transactionForm: document.querySelector("#transactionForm"),
  categoryField: document.querySelector("#categoryField"),
  amountField: document.querySelector("#amountField"),
  datetimeField: document.querySelector("#datetimeField"),
  useNowButton: document.querySelector("#useNowButton"),
  pieChart: document.querySelector("#pieChart"),
  pieChartTotal: document.querySelector("#pieChartTotal"),
  barChart: document.querySelector("#barChart"),
  barChartHeading: document.querySelector("#barChartHeading"),
  barChartHint: document.querySelector("#barChartHint"),
  categoryBreakdown: document.querySelector("#categoryBreakdown"),
  analysisTitle: document.querySelector("#analysisTitle"),
  analysisSubtitle: document.querySelector("#analysisSubtitle"),
  adviceList: document.querySelector("#adviceList"),
  refreshAdviceButton: document.querySelector("#refreshAdviceButton"),
  template: document.querySelector("#transactionItemTemplate"),
};

boot();

function boot() {
  hydrateState();
  populateCategories("expense");
  bindEvents();
  renderAll();
  registerServiceWorker();
}

function hydrateState() {
  const currentTransactions = readTransactionsFromStorage(STORAGE_KEY);
  const legacyTransactions = getLegacyTransactions();

  if (legacyTransactions.length > 0 && shouldRecoverFromLegacy(currentTransactions, legacyTransactions)) {
    state.transactions = legacyTransactions.map(migrateTransaction);
    persistTransactions();
  } else if (currentTransactions.length > 0) {
    state.transactions = currentTransactions.map(migrateTransaction);
    persistTransactions();
  } else {
    state.transactions = getSeedTransactions();
    persistTransactions();
  }

  elements.monthSelector.value = state.selectedMonth;
  buildYearOptions();
  elements.yearSelector.value = state.selectedYear;
  fillNow();
}

function getLegacyTransactions() {
  for (const key of LEGACY_STORAGE_KEYS) {
    const transactions = readTransactionsFromStorage(key);
    if (transactions.length > 0) {
      return transactions;
    }
  }

  return [];
}

function readTransactionsFromStorage(key) {
  const value = localStorage.getItem(key);

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shouldRecoverFromLegacy(currentTransactions, legacyTransactions) {
  if (legacyTransactions.length === 0) {
    return false;
  }

  if (currentTransactions.length === 0) {
    return true;
  }

  if (isLikelySeedData(currentTransactions)) {
    return true;
  }

  const currentHasOnlyUnknownCategories = currentTransactions.every((item) =>
    !transactionLooksLegacy(item) &&
    !transactionLooksLikeNewCategory(item.category),
  );
  const legacyLooksReal = legacyTransactions.some(transactionLooksLegacy);

  if (currentHasOnlyUnknownCategories && legacyLooksReal) {
    return true;
  }

  return false;
}

function isLikelySeedData(transactions) {
  if (transactions.length === 0 || transactions.length > 8) {
    return false;
  }

  const merchantMatches = transactions.filter((item) => KNOWN_SEED_MERCHANTS.has(item.merchant)).length;
  return merchantMatches >= Math.min(4, transactions.length);
}

function transactionLooksLegacy(transaction) {
  return [
    "餐饮",
    "超市",
    "交通",
    "房租",
    "水电网",
    "购物",
    "娱乐",
    "医疗",
    "订阅",
    "转账收入",
    "投资收益",
  ].includes(transaction.category);
}

function transactionLooksLikeNewCategory(category) {
  return DEFAULT_CATEGORIES.expense.includes(category) || DEFAULT_CATEGORIES.income.includes(category);
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.querySelectorAll('input[name="viewMode"]').forEach((radio) => {
    radio.addEventListener("change", (event) => {
      state.viewMode = event.target.value;
      renderAll();
    });
  });

  elements.monthSelector.addEventListener("change", (event) => {
    state.selectedMonth = event.target.value;
    state.selectedYear = state.selectedMonth.slice(0, 4);
    buildYearOptions();
    renderAll();
  });

  elements.yearSelector.addEventListener("change", (event) => {
    state.selectedYear = event.target.value;
    renderAll();
  });

  elements.transactionForm.addEventListener("submit", onSubmitTransaction);
  elements.transactionForm.querySelectorAll('input[name="type"]').forEach((radio) => {
    radio.addEventListener("change", (event) => populateCategories(event.target.value));
  });

  elements.useNowButton.addEventListener("click", fillNow);
  elements.refreshAdviceButton.addEventListener("click", renderAdvice);
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabId);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
}

function populateCategories(type) {
  elements.categoryField.innerHTML = DEFAULT_CATEGORIES[type]
    .map((category) => `<option value="${category}">${category}</option>`)
    .join("");
}

function onSubmitTransaction(event) {
  event.preventDefault();
  const formData = new FormData(elements.transactionForm);
  const datetime = formData.get("datetime");
  const type = formData.get("type");
  const transaction = {
    id: crypto.randomUUID(),
    type,
    amount: Number(formData.get("amount")),
    datetime,
    date: datetime.slice(0, 10),
    category: formData.get("category"),
    merchant: formData.get("merchant").trim(),
    note: formData.get("note").trim(),
    createdAt: new Date().toISOString(),
  };

  state.transactions.unshift(transaction);
  state.selectedMonth = transaction.datetime.slice(0, 7);
  state.selectedYear = transaction.datetime.slice(0, 4);
  buildYearOptions();
  persistTransactions();
  resetForm();
  renderAll();
  switchTab("dashboard");
}

function resetForm() {
  elements.transactionForm.reset();
  elements.transactionForm.querySelector('input[name="type"][value="expense"]').checked = true;
  populateCategories("expense");
  fillNow();
}

function renderAll() {
  buildYearOptions();
  renderPeriodControls();
  renderSummary();
  renderTransactions();
  renderPieChart();
  renderBarChart();
  renderCategoryBreakdown();
  renderAdvice();
}

function renderPeriodControls() {
  const isMonthView = state.viewMode === "month";
  elements.monthFilterWrap.classList.toggle("is-hidden", !isMonthView);
  elements.yearFilterWrap.classList.toggle("is-hidden", isMonthView);
  elements.monthSelector.value = state.selectedMonth;
  elements.yearSelector.value = state.selectedYear;
}

function renderSummary() {
  const transactions = getSelectedTransactions();
  const income = sumByType(transactions, "income");
  const expense = sumByType(transactions, "expense");
  const balance = income - expense;
  const expenseEntries = transactions.filter((item) => item.type === "expense");
  const topExpenseCategory = getTopCategory(transactions, "expense");
  const topIncomeCategory = getTopCategory(transactions, "income");
  const savingsRate = income > 0 ? `${Math.max(0, ((balance / income) * 100).toFixed(0))}%` : "0%";
  const averageExpense =
    expenseEntries.length > 0 ? formatCurrency(expense / expenseEntries.length) : formatCurrency(0);
  const lastTransaction = transactions.slice().sort((a, b) => b.datetime.localeCompare(a.datetime))[0];
  const periodLabel = getSelectedLabel();

  elements.periodBadge.textContent = state.viewMode === "month" ? "月度视图" : "年度视图";
  elements.periodTitle.textContent = periodLabel;
  elements.periodSubtitle.textContent =
    state.viewMode === "month"
      ? "聚焦这个月的收入、支出和分类走势。"
      : "从全年角度看每个月的收支变化。";
  elements.analysisTitle.textContent = `${periodLabel} 图表`;
  elements.analysisSubtitle.textContent =
    state.viewMode === "month"
      ? "饼图看本月分类，柱状图看月内每天的变化。"
      : "饼图看全年分类，柱状图看每个月的变化。";

  elements.periodIncome.textContent = formatCurrency(income);
  elements.periodExpense.textContent = formatCurrency(expense);
  elements.periodSavingRate.textContent = savingsRate;
  elements.entryCount.textContent = `${transactions.length} 笔`;
  elements.heroBalance.textContent = formatCurrency(balance);
  elements.heroSummary.textContent = getHeroSummary(periodLabel, balance, topExpenseCategory, transactions.length);
  elements.topCategory.textContent = topExpenseCategory
    ? `${topExpenseCategory.category} · ${formatCurrency(topExpenseCategory.amount)}`
    : "还没有";
  elements.topIncomeCategory.textContent = topIncomeCategory
    ? `${topIncomeCategory.category} · ${formatCurrency(topIncomeCategory.amount)}`
    : "还没有";
  elements.averageExpense.textContent = averageExpense;
  elements.lastTransactionTime.textContent = lastTransaction
    ? formatDateTime(lastTransaction.datetime)
    : "还没有";
}

function renderTransactions() {
  const transactions = getSelectedTransactions()
    .slice()
    .sort((a, b) => b.datetime.localeCompare(a.datetime))
    .slice(0, 12);
  const fragment = document.createDocumentFragment();

  if (!transactions.length) {
    elements.transactionList.innerHTML = `<li class="empty-state">这个周期还没有记录，先记一笔就会开始显示。</li>`;
    return;
  }

  transactions.forEach((transaction) => {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const amountText = `${transaction.type === "income" ? "+" : "-"}${formatCurrency(transaction.amount)}`;
    const meta = [formatDateTime(transaction.datetime), transaction.category, transaction.note || ""]
      .filter(Boolean)
      .join(" · ");

    node.querySelector(".item-title").textContent = transaction.merchant || transaction.category;
    node.querySelector(".item-meta").textContent = meta;
    node.querySelector(".type-badge").textContent = transaction.type === "income" ? "收入" : "支出";
    node.querySelector(".type-badge").classList.add(
      transaction.type === "income" ? "income-badge" : "expense-badge",
    );
    node.querySelector(".item-amount").textContent = amountText;
    node.querySelector(".item-amount").classList.add(
      transaction.type === "income" ? "income-amount" : "expense-amount",
    );
    node.querySelector(".text-button").addEventListener("click", () => deleteTransaction(transaction.id));
    fragment.appendChild(node);
  });

  elements.transactionList.innerHTML = "";
  elements.transactionList.appendChild(fragment);
}

function renderPieChart() {
  const expenses = getSelectedTransactions().filter((item) => item.type === "expense");
  const grouped = groupByCategory(expenses);
  const total = grouped.reduce((sum, item) => sum + item.amount, 0);
  elements.pieChartTotal.textContent = `总支出 ${formatCurrency(total)}`;

  if (!grouped.length) {
    elements.pieChart.innerHTML = `<div class="empty-state chart-empty">当前周期还没有支出，暂时无法生成饼图。</div>`;
    return;
  }

  let start = 0;
  const stops = grouped.map((item, index) => {
    const percentage = total > 0 ? (item.amount / total) * 100 : 0;
    const end = start + percentage;
    const color = CHART_COLORS[index % CHART_COLORS.length];
    const segment = `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    start = end;
    return { ...item, percentage, color, segment };
  });

  const gradient = stops.map((item) => item.segment).join(", ");

  elements.pieChart.innerHTML = `
    <div class="donut-layout">
      <div class="donut-ring" style="background: conic-gradient(${gradient})">
        <div class="donut-center">
          <strong>${formatCurrency(total)}</strong>
          <span>总支出</span>
        </div>
      </div>
      <div class="legend-list">
        ${stops
          .map(
            (item) => `
              <article class="legend-item">
                <div class="legend-title">
                  <span class="legend-dot" style="background:${item.color}"></span>
                  <strong>${item.category}</strong>
                </div>
                <span>${formatCurrency(item.amount)} · ${item.percentage.toFixed(0)}%</span>
              </article>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderBarChart() {
  const data = state.viewMode === "month" ? buildDailyBarData() : buildYearlyBarData();
  const maxAmount = data.reduce((max, item) => Math.max(max, item.income, item.expense), 0);

  elements.barChartHeading.textContent =
    state.viewMode === "month" ? "月内趋势柱状图" : "年度月份柱状图";
  elements.barChartHint.textContent = state.viewMode === "month" ? "按天查看" : "按月查看";

  if (!data.length || maxAmount === 0) {
    elements.barChart.innerHTML = `<div class="empty-state chart-empty">当前周期数据不足，暂时无法生成柱状图。</div>`;
    return;
  }

  elements.barChart.innerHTML = `
    <div class="bar-chart-scroll">
      <div class="bar-chart-grid">
        ${data
          .map((item) => {
            const incomeHeight = maxAmount > 0 ? (item.income / maxAmount) * 100 : 0;
            const expenseHeight = maxAmount > 0 ? (item.expense / maxAmount) * 100 : 0;
            return `
              <article class="bar-group">
                <div class="bar-stack">
                  <span class="bar income-bar" style="height:${incomeHeight}%"></span>
                  <span class="bar expense-bar" style="height:${expenseHeight}%"></span>
                </div>
                <strong>${item.label}</strong>
                <small>收 ${shortCurrency(item.income)} / 支 ${shortCurrency(item.expense)}</small>
              </article>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderCategoryBreakdown() {
  const expenses = getSelectedTransactions().filter((item) => item.type === "expense");
  const grouped = groupByCategory(expenses);
  const total = grouped.reduce((sum, item) => sum + item.amount, 0);

  if (!grouped.length) {
    elements.categoryBreakdown.innerHTML = `<div class="empty-state">当前周期还没有支出分类可分析。</div>`;
    return;
  }

  elements.categoryBreakdown.innerHTML = grouped
    .map((item) => {
      const ratio = total > 0 ? (item.amount / total) * 100 : 0;
      return `
        <article class="breakdown-item">
          <div class="breakdown-head">
            <strong>${item.category}</strong>
            <span>${formatCurrency(item.amount)} · ${ratio.toFixed(0)}%</span>
          </div>
          <div class="breakdown-bar"><span style="width:${ratio}%"></span></div>
        </article>
      `;
    })
    .join("");
}

function renderAdvice() {
  const advice = generateAdvice();
  elements.adviceList.innerHTML = advice
    .map(
      (item) => `
        <article class="advice-card">
          <p class="advice-tag">${item.tag}</p>
          <strong>${item.title}</strong>
          <p>${item.body}</p>
        </article>
      `,
    )
    .join("");
}

function deleteTransaction(id) {
  state.transactions = state.transactions.filter((item) => item.id !== id);
  buildYearOptions();
  persistTransactions();
  renderAll();
}

function generateAdvice() {
  const transactions = getSelectedTransactions();
  const expense = sumByType(transactions, "expense");
  const income = sumByType(transactions, "income");
  const balance = income - expense;
  const topExpense = getTopCategory(transactions, "expense");
  const dining = getCategoryTotalByType(transactions, "expense", "外卖堂食");
  const groceries = getCategoryTotalByType(transactions, "expense", "买菜华超");
  const rent = getCategoryTotalByType(transactions, "expense", "房租水电");
  const subscriptions = getCategoryTotalByType(transactions, "expense", "订阅软件");
  const fuel = getCategoryTotalByType(transactions, "expense", "燃油");
  const autoCare = getCategoryTotalByType(transactions, "expense", "汽车保险保养");
  const sideIncome = getCategoryTotalByType(transactions, "income", "副业收入");
  const label = state.viewMode === "month" ? "本月" : "今年";

  if (!transactions.length) {
    return [
      {
        tag: "起步",
        title: "先把常见收支记完整",
        body: "先录主业收入、房租、吃饭、买菜、通勤这几类，等数据积累起来后，月视图和年视图才会更有参考价值。",
      },
      {
        tag: "数据继承",
        title: "旧数据已经自动保留",
        body: "你之前在手机里录入的数据会继续沿用，不需要重新输入。接下来只需要继续在同一个网址记账即可。",
      },
    ];
  }

  const advice = [];

  if (income > 0) {
    const savingsRate = balance / income;
    advice.push({
      tag: "现金流",
      title: savingsRate >= 0.2 ? `${label}结余还不错` : `${label}先把储蓄率拉回到 20% 左右`,
      body:
        savingsRate >= 0.2
          ? `${label}储蓄率大约是 ${Math.max(0, savingsRate * 100).toFixed(0)}%，说明结构已经比较稳，可以继续守住结余。`
          : `${label}储蓄率大约是 ${Math.max(0, savingsRate * 100).toFixed(0)}%，先从最大支出分类下手，比平均压缩每一类更容易见效。`,
    });
  } else {
    advice.push({
      tag: "完整度",
      title: "把收入也一起记进去",
      body: "如果只有支出没有收入，月视图和年视图的判断会失真。建议至少把主业收入和副业收入补齐。",
    });
  }

  if (topExpense) {
    advice.push({
      tag: "重点",
      title: `先盯住 ${topExpense.category}`,
      body: `${topExpense.category} 是当前周期最大支出，金额约 ${formatCurrency(topExpense.amount)}。先给它设上限，会比泛泛地“少花点”更有效。`,
    });
  }

  if (expense > 0 && dining / expense > 0.18) {
    advice.push({
      tag: "节流",
      title: "外卖堂食占比偏高",
      body: `${label}外卖堂食占比较高。若平时常在曼哈顿上班，可以把工作日午饭的一部分改成自带或 lunch special，通常最容易立刻省下来。`,
    });
  }

  if (groceries > 0 && dining > groceries * 1.5) {
    advice.push({
      tag: "结构",
      title: "吃饭结构可以往买菜倾斜一点",
      body: `${label}外食明显高于买菜华超。提前备几样快手菜，往往比临时点单更省，而且更容易持续。`,
    });
  }

  if (income > 0 && rent / income > 0.35) {
    advice.push({
      tag: "固定成本",
      title: "房租压力高，变量支出更值得盯",
      body: `${label}房租水电大约占收入的 ${((rent / income) * 100).toFixed(0)}%。这类固定开销在纽约常见，所以更现实的优化点是吃饭、购物、订阅和车辆相关支出。`,
    });
  }

  if (subscriptions > (state.viewMode === "month" ? 60 : 720)) {
    advice.push({
      tag: "订阅",
      title: "订阅类支出值得清理一次",
      body: `${label}订阅软件支出已经不低了。把不常用的流媒体、云盘、工具类订阅停掉一两个，长期效果很明显。`,
    });
  }

  if (fuel + autoCare > 0 && expense > 0 && (fuel + autoCare) / expense > 0.12) {
    advice.push({
      tag: "用车",
      title: "车辆相关成本需要单独盯",
      body: `燃油和汽车保险保养在当前周期里已经形成明显占比。建议后面把加油、保养、保险继续分开记，这样更容易判断车的实际持有成本。`,
    });
  }

  if (income > 0 && sideIncome === 0 && balance / Math.max(income, 1) < 0.15) {
    advice.push({
      tag: "开源",
      title: "可以补一条轻量副业收入线",
      body: "如果主业结余不高，副业收入哪怕先从小额开始，也能明显增加安全垫。适合先选启动成本低、时间可控的方式。",
    });
  }

  advice.push({
    tag: "复盘",
    title: "月度看节流，年度看趋势",
    body: "月视图适合看本月最该管哪一类，年视图适合看哪几个月支出抬头最明显。把这两个视角分开，会比只看流水更清楚。",
  });

  return advice.slice(0, 6);
}

function persistTransactions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transactions));
}

function migrateTransaction(transaction) {
  const rawDate = transaction.datetime || transaction.date || getToday();
  const datetime = normalizeDatetime(rawDate);
  const rawAmount = Number(transaction.amount || 0);
  const normalizedType = normalizeTransactionType(transaction.type, rawAmount);

  return {
    ...transaction,
    type: normalizedType,
    amount: Math.abs(rawAmount),
    datetime,
    date: datetime.slice(0, 10),
    category: CATEGORY_MIGRATION[transaction.category] || transaction.category || "其他",
    merchant: transaction.merchant || "",
    note: transaction.note || "",
  };
}

function normalizeTransactionType(type, amount) {
  if (type === "income" || type === "expense") {
    if (amount < 0 && type === "income") {
      return "expense";
    }

    if (amount > 0 && type === "expense") {
      return "expense";
    }

    return type;
  }

  return amount < 0 ? "expense" : "income";
}

function buildYearOptions() {
  const years = new Set([getCurrentYear()]);

  state.transactions.forEach((item) => {
    years.add(item.datetime.slice(0, 4));
  });

  const options = Array.from(years).sort((a, b) => Number(b) - Number(a));

  elements.yearSelector.innerHTML = options
    .map((year) => `<option value="${year}">${year} 年</option>`)
    .join("");

  if (!options.includes(state.selectedYear)) {
    state.selectedYear = options[0];
  }
}

function getSelectedTransactions() {
  return state.viewMode === "month"
    ? state.transactions.filter((item) => item.datetime.startsWith(state.selectedMonth))
    : state.transactions.filter((item) => item.datetime.startsWith(state.selectedYear));
}

function sumByType(transactions, type) {
  return transactions
    .filter((item) => item.type === type)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function groupByCategory(transactions) {
  const map = new Map();

  transactions.forEach((item) => {
    map.set(item.category, (map.get(item.category) || 0) + Number(item.amount || 0));
  });

  return Array.from(map.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function getTopCategory(transactions, type) {
  return groupByCategory(transactions.filter((item) => item.type === type))[0];
}

function getCategoryTotalByType(transactions, type, category) {
  return transactions
    .filter((item) => item.type === type && item.category === category)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function buildDailyBarData() {
  const transactions = getSelectedTransactions();
  const grouped = new Map();

  transactions.forEach((item) => {
    const day = item.date.slice(8, 10);
    if (!grouped.has(day)) {
      grouped.set(day, { label: `${Number(day)}日`, income: 0, expense: 0 });
    }
    grouped.get(day)[item.type] += Number(item.amount || 0);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, value]) => value);
}

function buildYearlyBarData() {
  const months = Array.from({ length: 12 }, (_, index) => ({
    label: `${index + 1}月`,
    income: 0,
    expense: 0,
  }));

  getSelectedTransactions().forEach((item) => {
    const monthIndex = Number(item.datetime.slice(5, 7)) - 1;
    months[monthIndex][item.type] += Number(item.amount || 0);
  });

  return months;
}

function getSelectedLabel() {
  if (state.viewMode === "month") {
    const [year, month] = state.selectedMonth.split("-");
    return `${year} 年 ${Number(month)} 月`;
  }

  return `${state.selectedYear} 年`;
}

function getHeroSummary(periodLabel, balance, topExpenseCategory, count) {
  if (count === 0) {
    return "当前周期还没有记录，先记一笔就会自动开始分析。";
  }

  if (balance >= 0) {
    return `${periodLabel}当前结余为正，重点支出是 ${topExpenseCategory?.category || "其他"}。`;
  }

  return `${periodLabel}当前支出高于收入，先从 ${topExpenseCategory?.category || "最大支出"} 开始收紧。`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function shortCurrency(value) {
  if (!value) {
    return "$0";
  }

  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }

  return `$${Math.round(value)}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function fillNow() {
  elements.datetimeField.value = getCurrentDatetimeLocal();
}

function normalizeDatetime(value) {
  if (value.includes("T")) {
    return value.slice(0, 16);
  }

  return `${value.slice(0, 10)}T12:00`;
}

function getCurrentMonth() {
  return getCurrentDatetimeLocal().slice(0, 7);
}

function getCurrentYear() {
  return getCurrentDatetimeLocal().slice(0, 4);
}

function getCurrentDatetimeLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getToday() {
  return getCurrentDatetimeLocal().slice(0, 10);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }
}

function getSeedTransactions() {
  const month = getCurrentMonth();
  const year = getCurrentYear();

  return [
    {
      id: crypto.randomUUID(),
      type: "income",
      amount: 5600,
      datetime: `${month}-01T09:10`,
      date: `${month}-01`,
      category: "主业收入",
      merchant: "公司",
      note: "工资到账",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      type: "income",
      amount: 320,
      datetime: `${month}-03T21:00`,
      date: `${month}-03`,
      category: "副业收入",
      merchant: "客户",
      note: "周末接单",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      type: "expense",
      amount: 38,
      datetime: `${month}-04T12:20`,
      date: `${month}-04`,
      category: "外卖堂食",
      merchant: "午饭",
      note: "",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      type: "expense",
      amount: 82,
      datetime: `${month}-05T19:10`,
      date: `${month}-05`,
      category: "买菜华超",
      merchant: "超市",
      note: "一周买菜",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      type: "expense",
      amount: 76,
      datetime: `${year}-01-15T08:10`,
      date: `${year}-01-15`,
      category: "汽车保险保养",
      merchant: "保险",
      note: "保险账单",
      createdAt: new Date().toISOString(),
    },
  ];
}
