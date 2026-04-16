const STORAGE_KEY = "budget-flow-transactions-v1";
const DEFAULT_CATEGORIES = {
  expense: [
    "Dining",
    "Transit",
    "Groceries",
    "Rent & Utilities",
    "Shopping",
    "Entertainment",
    "Healthcare",
    "Travel",
    "Other",
  ],
  income: ["Paycheck", "Bonus", "Freelance", "Investment", "Refund", "Other"],
};
const CATEGORY_MIGRATION = {
  餐饮: "Dining",
  交通: "Transit",
  购物: "Shopping",
  住房: "Rent & Utilities",
  娱乐: "Entertainment",
  医疗: "Healthcare",
  旅行: "Travel",
  学习: "Other",
  其他: "Other",
  工资: "Paycheck",
  奖金: "Bonus",
  副业: "Freelance",
  理财: "Investment",
  退款: "Refund",
};
const PAYMENT_METHOD_MIGRATION = {
  支付宝: "Credit Card",
  微信: "Apple Pay",
  银行卡: "Debit Card",
  现金: "Cash",
  其他: "Other",
};

const state = {
  transactions: [],
  selectedMonth: getCurrentMonth(),
};

const elements = {
  heroBalance: document.querySelector("#heroBalance"),
  heroSummary: document.querySelector("#heroSummary"),
  monthIncome: document.querySelector("#monthIncome"),
  monthExpense: document.querySelector("#monthExpense"),
  monthSavingRate: document.querySelector("#monthSavingRate"),
  netIncome: document.querySelector("#netIncome"),
  topCategory: document.querySelector("#topCategory"),
  entryCount: document.querySelector("#entryCount"),
  categoryChart: document.querySelector("#categoryChart"),
  transactionList: document.querySelector("#transactionList"),
  transactionForm: document.querySelector("#transactionForm"),
  categoryField: document.querySelector("#categoryField"),
  monthSelector: document.querySelector("#monthSelector"),
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
  const storedTransactions = localStorage.getItem(STORAGE_KEY);

  if (storedTransactions) {
    try {
      state.transactions = JSON.parse(storedTransactions).map(migrateTransaction);
      persistTransactions();
    } catch {
      state.transactions = [];
    }
  } else {
    state.transactions = getSeedTransactions();
    persistTransactions();
  }

  elements.monthSelector.value = state.selectedMonth;
  elements.transactionForm.date.value = getToday();
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  elements.transactionForm.addEventListener("submit", onSubmitTransaction);
  elements.transactionForm.querySelectorAll('input[name="type"]').forEach((radio) => {
    radio.addEventListener("change", (event) => populateCategories(event.target.value));
  });

  elements.monthSelector.addEventListener("change", (event) => {
    state.selectedMonth = event.target.value;
    renderAll();
  });

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
  const categories = DEFAULT_CATEGORIES[type];
  elements.categoryField.innerHTML = categories
    .map((category) => `<option value="${category}">${category}</option>`)
    .join("");
}

function onSubmitTransaction(event) {
  event.preventDefault();
  const formData = new FormData(elements.transactionForm);
  const type = formData.get("type");
  const transaction = {
    id: crypto.randomUUID(),
    type,
    amount: Number(formData.get("amount")),
    date: formData.get("date"),
    category: formData.get("category"),
    paymentMethod: formData.get("paymentMethod"),
    note: formData.get("note").trim(),
    merchant: "",
    createdAt: new Date().toISOString(),
  };

  state.transactions.unshift(transaction);
  state.selectedMonth = transaction.date.slice(0, 7);
  persistTransactions();
  elements.transactionForm.reset();
  elements.transactionForm.querySelector('input[name="type"][value="expense"]').checked = true;
  elements.transactionForm.date.value = getToday();
  elements.monthSelector.value = state.selectedMonth;
  populateCategories("expense");
  renderAll();
  switchTab("dashboard");
}

function renderAll() {
  renderSummary();
  renderTransactions();
  renderCategoryChart();
  renderAdvice();
}

function renderSummary() {
  const monthTransactions = getMonthTransactions();
  const income = sumByType(monthTransactions, "income");
  const expense = sumByType(monthTransactions, "expense");
  const balance = income - expense;
  const savingRate = income > 0 ? `${Math.max(0, ((balance / income) * 100).toFixed(0))}%` : "0%";

  elements.monthIncome.textContent = formatCurrency(income);
  elements.monthExpense.textContent = formatCurrency(expense);
  elements.monthSavingRate.textContent = savingRate;
  elements.netIncome.textContent = formatCurrency(balance);
  elements.entryCount.textContent = `${monthTransactions.length} entries`;

  const topCategory = getTopExpenseCategory(monthTransactions);
  elements.topCategory.textContent = topCategory ? `${topCategory.category} · ${formatCurrency(topCategory.amount)}` : "None yet";
  elements.heroBalance.textContent = formatCurrency(balance);
  elements.heroSummary.textContent =
    expense === 0
      ? "No spending logged this month yet."
      : `${monthTransactions.length} entries logged this month. Your biggest category is ${topCategory?.category || "Other"}.`;
}

function renderTransactions() {
  const fragment = document.createDocumentFragment();
  const monthTransactions = getMonthTransactions().slice().sort((a, b) => b.date.localeCompare(a.date));

  if (!monthTransactions.length) {
    elements.transactionList.innerHTML = `<li class="empty-state">No entries for this month yet</li>`;
    return;
  }

  monthTransactions.forEach((transaction) => {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const title = transaction.merchant || transaction.category;
    const meta = [
      transaction.date,
      transaction.category,
      transaction.paymentMethod || "Not set",
      transaction.note || "",
    ]
      .filter(Boolean)
      .join(" · ");
    const amountText = `${transaction.type === "income" ? "+" : "-"}${formatCurrency(transaction.amount)}`;

    node.querySelector(".item-title").textContent = title;
    node.querySelector(".item-meta").textContent = meta;
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

function renderCategoryChart() {
  const expenses = getMonthTransactions().filter((item) => item.type === "expense");
  const totalExpense = expenses.reduce((sum, item) => sum + item.amount, 0);

  if (!expenses.length) {
    elements.categoryChart.className = "chart-list empty-state";
    elements.categoryChart.textContent = "No spending data yet";
    return;
  }

  const grouped = groupExpensesByCategory(expenses);
  const html = grouped
    .map(({ category, amount }) => {
      const width = totalExpense > 0 ? (amount / totalExpense) * 100 : 0;
      return `
        <article class="chart-row">
          <header>
            <strong>${category}</strong>
            <span>${formatCurrency(amount)} · ${width.toFixed(0)}%</span>
          </header>
          <div class="chart-bar"><span style="width:${width}%"></span></div>
        </article>
      `;
    })
    .join("");

  elements.categoryChart.className = "chart-list";
  elements.categoryChart.innerHTML = html;
}

function renderAdvice() {
  const advice = generateAdvice(state.transactions);
  elements.adviceList.innerHTML = advice
    .map(
      (item) => `
        <article class="advice-card">
          <strong>${item.title}</strong>
          <p>${item.body}</p>
        </article>
      `,
    )
    .join("");
}

function deleteTransaction(id) {
  state.transactions = state.transactions.filter((item) => item.id !== id);
  persistTransactions();
  renderAll();
}

function persistTransactions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transactions));
}

function migrateTransaction(transaction) {
  return {
    ...transaction,
    category: CATEGORY_MIGRATION[transaction.category] || transaction.category || "Other",
    paymentMethod:
      PAYMENT_METHOD_MIGRATION[transaction.paymentMethod] || transaction.paymentMethod || "Other",
  };
}

function getMonthTransactions() {
  return state.transactions.filter((item) => item.date.startsWith(state.selectedMonth));
}

function sumByType(transactions, type) {
  return transactions
    .filter((item) => item.type === type)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function groupExpensesByCategory(expenses) {
  const map = new Map();

  expenses.forEach((item) => {
    map.set(item.category, (map.get(item.category) || 0) + item.amount);
  });

  return Array.from(map.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function getTopExpenseCategory(transactions) {
  return groupExpensesByCategory(transactions.filter((item) => item.type === "expense"))[0];
}

function generateAdvice(transactions) {
  if (!transactions.length) {
    return [
      {
        title: "Start with a 7-day logging streak",
        body: "Log every expense and income item for one full week first. Once the app has more data, the suggestions will fit your actual NYC routine much better.",
      },
    ];
  }

  const currentMonthTransactions = getMonthTransactions();
  const income = sumByType(currentMonthTransactions, "income");
  const expense = sumByType(currentMonthTransactions, "expense");
  const advice = [];
  const topCategory = getTopExpenseCategory(currentMonthTransactions);

  if (income > 0) {
    const savingRate = (income - expense) / income;
    if (savingRate < 0.2) {
      advice.push({
        title: "Aim for a 20% savings rate",
        body: `Your savings rate is about ${(savingRate * 100).toFixed(0)}% this month. A practical move is to auto-transfer 10% of each paycheck into savings, then gradually push it closer to 20%.`,
      });
    } else {
      advice.push({
        title: "You have room to grow income",
        body: "You already have some monthly cushion. In New York, even a modest side stream like tutoring, freelance work, weekend shifts, or selling unused items can noticeably strengthen your buffer.",
      });
    }
  } else {
    advice.push({
      title: "Add income entries too",
      body: "There is no income data in your ledger yet. Add paychecks, freelance income, reimbursements, and refunds so the advice can be more accurate.",
    });
  }

  if (topCategory) {
    advice.push({
      title: `Focus on ${topCategory.category}`,
      body: `${topCategory.category} is your biggest category this month at about ${formatCurrency(topCategory.amount)}. Start with one weekly cap for that category instead of trying to change every habit at once.`,
    });
  }

  const diningExpense = currentMonthTransactions
    .filter((item) => item.type === "expense" && item.category === "Dining")
    .reduce((sum, item) => sum + item.amount, 0);
  if (diningExpense > 450) {
    advice.push({
      title: "Dining has room to tighten",
      body: `You have already spent ${formatCurrency(diningExpense)} on dining this month. In NYC, cutting even one delivery order or one takeout lunch per workweek can add up quickly.`,
    });
  }

  const shoppingExpense = currentMonthTransactions
    .filter((item) => item.type === "expense" && item.category === "Shopping")
    .reduce((sum, item) => sum + item.amount, 0);
  if (shoppingExpense > 350) {
    advice.push({
      title: "Use a 48-hour rule for shopping",
      body: "For non-essential purchases, wait 48 hours before checking out. That pause usually cuts impulse spending more effectively than relying on willpower in the moment.",
    });
  }

  const transitExpense = currentMonthTransactions
    .filter((item) => item.type === "expense" && item.category === "Transit")
    .reduce((sum, item) => sum + item.amount, 0);
  if (transitExpense > 180) {
    advice.push({
      title: "Review subway vs rideshare",
      body: `Transit spending is already ${formatCurrency(transitExpense)} this month. If part of that is rideshare, shifting even a few trips to subway or bus can make a noticeable difference in New York.`,
    });
  }

  const housingExpense = currentMonthTransactions
    .filter((item) => item.type === "expense" && item.category === "Rent & Utilities")
    .reduce((sum, item) => sum + item.amount, 0);
  if (income > 0 && housingExpense / income > 0.35) {
    advice.push({
      title: "Housing is taking a big share",
      body: `Rent and utilities are about ${((housingExpense / income) * 100).toFixed(0)}% of your income this month. That is common in NYC, so your easiest wins may be dining, subscriptions, and rideshare rather than essentials.`,
    });
  }

  advice.push({
    title: "Keep a monthly NYC money check-in",
    body: "At the end of each month, ask just two questions: which category is easiest to trim next month, and which skill or habit could raise your income. A short routine beats an overcomplicated budget.",
  });

  return advice;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function getCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  return [
    {
      id: crypto.randomUUID(),
      type: "income",
      amount: 5400,
      date: `${month}-05`,
      category: "Paycheck",
      paymentMethod: "Direct Deposit",
      note: "Primary paycheck",
      merchant: "",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      type: "expense",
      amount: 18.5,
      date: `${month}-06`,
      category: "Dining",
      paymentMethod: "Credit Card",
      note: "Lunch in Midtown",
      merchant: "Sweetgreen",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      type: "expense",
      amount: 34,
      date: `${month}-07`,
      category: "Transit",
      paymentMethod: "Apple Pay",
      note: "Subway and bus rides",
      merchant: "",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      type: "expense",
      amount: 96,
      date: `${month}-08`,
      category: "Groceries",
      paymentMethod: "Debit Card",
      note: "Weekly grocery run",
      merchant: "",
      createdAt: new Date().toISOString(),
    },
  ];
}
