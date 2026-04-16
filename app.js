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
  receiptImageDataUrl: "",
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
  scanCategoryField: document.querySelector("#scanCategoryField"),
  monthSelector: document.querySelector("#monthSelector"),
  adviceList: document.querySelector("#adviceList"),
  receiptFile: document.querySelector("#receiptFile"),
  scanReceiptButton: document.querySelector("#scanReceiptButton"),
  receiptPreview: document.querySelector("#receiptPreview"),
  receiptPlaceholder: document.querySelector("#receiptPlaceholder"),
  scanStatus: document.querySelector("#scanStatus"),
  scanResultForm: document.querySelector("#scanResultForm"),
  refreshAdviceButton: document.querySelector("#refreshAdviceButton"),
  template: document.querySelector("#transactionItemTemplate"),
};

boot();

function boot() {
  hydrateState();
  populateCategories("expense");
  populateScanCategories();
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
  elements.scanResultForm.date.value = getToday();
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

  elements.receiptFile.addEventListener("change", onReceiptSelected);
  elements.scanReceiptButton.addEventListener("click", onScanReceipt);
  elements.scanResultForm.addEventListener("submit", onSaveScanResult);
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

function populateScanCategories() {
  const categories = DEFAULT_CATEGORIES.expense;
  const html = categories
    .map((category) => `<option value="${category}">${category}</option>`)
    .join("");
  elements.scanCategoryField.innerHTML = html;
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
  persistTransactions();
  elements.transactionForm.reset();
  elements.transactionForm.querySelector('input[name="type"][value="expense"]').checked = true;
  elements.transactionForm.date.value = getToday();
  populateCategories("expense");
  renderAll();
  switchTab("dashboard");
}

async function onReceiptSelected(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  state.receiptImageDataUrl = await fileToDataUrl(file);
  elements.receiptPreview.src = state.receiptImageDataUrl;
  elements.receiptPreview.hidden = false;
  elements.receiptPlaceholder.hidden = true;
  setScanStatus("Receipt uploaded. You can start scanning now.", "muted");
}

async function onScanReceipt() {
  if (!state.receiptImageDataUrl) {
    setScanStatus("Please upload a receipt photo first.", "error");
    return;
  }

  if (!window.Tesseract) {
    setScanStatus("OCR failed to load. Please refresh and try again.", "error");
    return;
  }

  setScanStatus("Scanning locally. The first run may take a little longer.", "muted");

  try {
    const parsed = await extractReceiptWithOCR(state.receiptImageDataUrl);
    fillScanResult(parsed);
    setScanStatus("Scan complete. Please review the details before saving.", "success");
    switchTab("receipt");
  } catch (error) {
    console.error(error);
    setScanStatus(
      "Scan failed. The image may be blurry, the network may be unavailable, or OCR may not have read the text correctly. You can still edit it manually and save.",
      "error",
    );
  }
}

function fillScanResult(parsed) {
  elements.scanResultForm.merchant.value = parsed.merchant || "";
  elements.scanResultForm.amount.value = parsed.amount || "";
  elements.scanResultForm.date.value = normalizeDate(parsed.date) || getToday();
  elements.scanResultForm.category.value = DEFAULT_CATEGORIES.expense.includes(parsed.category)
    ? parsed.category
    : "Other";
  elements.scanResultForm.note.value = [
    parsed.note?.trim(),
    parsed.items?.length ? `Detected items: ${parsed.items.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function onSaveScanResult(event) {
  event.preventDefault();
  const formData = new FormData(elements.scanResultForm);

  const transaction = {
    id: crypto.randomUUID(),
    type: "expense",
    amount: Number(formData.get("amount")),
    date: formData.get("date"),
    category: formData.get("category"),
    paymentMethod: "Other",
    note: formData.get("note").trim(),
    merchant: formData.get("merchant").trim(),
    createdAt: new Date().toISOString(),
  };

  if (!transaction.amount || !transaction.date) {
    setScanStatus("Please confirm at least the amount and date before saving.", "error");
    return;
  }

  state.transactions.unshift(transaction);
  persistTransactions();
  elements.scanResultForm.reset();
  elements.scanResultForm.date.value = getToday();
  renderAll();
  setScanStatus("Saved to your ledger.", "success");
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

async function extractReceiptWithOCR(imageDataUrl) {
  const {
    data: { text },
  } = await window.Tesseract.recognize(imageDataUrl, "chi_sim+eng", {
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        setScanStatus(`Scanning text ${(message.progress * 100).toFixed(0)}%`, "muted");
      }
    },
  });

  return parseReceiptText(text);
}

function parseReceiptText(rawText) {
  const text = rawText.replace(/\r/g, "").trim();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const amount = extractAmount(lines);
  const date = extractDate(text);
  const merchant = extractMerchant(lines);
  const category = guessCategory(`${merchant}\n${text}`);
  const items = extractItems(lines);

  return {
    merchant,
    amount,
    date,
    category,
    note: text,
    items,
  };
}

function extractAmount(lines) {
  const joined = lines.join("\n");
  const labeledMatches = [...joined.matchAll(/(?:合计|总计|应付|实付|消费金额|金额|TOTAL)[^\d]{0,8}(\d+[.,]?\d{0,2})/gi)];
  if (labeledMatches.length) {
    return Number(labeledMatches[labeledMatches.length - 1][1].replace(",", "."));
  }

  const candidates = [...joined.matchAll(/(?:^|[^\d])(\d{1,5}[.,]\d{2})(?:[^\d]|$)/g)].map((match) =>
    Number(match[1].replace(",", ".")),
  );

  if (!candidates.length) {
    return 0;
  }

  return Math.max(...candidates);
}

function extractDate(text) {
  const match =
    text.match(/(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/) ||
    text.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);

  if (!match) {
    return getToday();
  }

  const [, year, month, day] = match;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractMerchant(lines) {
  const firstUsefulLine = lines.find(
    (line) => /[\u4e00-\u9fa5A-Za-z]/.test(line) && !/cashier|welcome|thank|total|subtotal|tax|收银|欢迎|谢谢|合计|总计/i.test(line),
  );
  return firstUsefulLine || "Unknown merchant";
}

function extractItems(lines) {
  return lines
    .filter((line) => /[\u4e00-\u9fa5A-Za-z]/.test(line))
    .filter((line) => !/(total|subtotal|tax|tip|balance|change|cashier|welcome|thank|合计|总计|应付|实付|找零|收银)/i.test(line))
    .slice(0, 5);
}

function guessCategory(text) {
  const rules = [
    { category: "Dining", patterns: ["restaurant", "cafe", "coffee", "pizza", "deli", "bagel", "bar", "food", "ubereats", "doordash", "grubhub"] },
    { category: "Transit", patterns: ["mta", "subway", "train", "bus", "uber", "lyft", "taxi", "parking", "toll", "metro"] },
    { category: "Groceries", patterns: ["grocery", "market", "trader joe", "whole foods", "costco", "target", "supermarket"] },
    { category: "Rent & Utilities", patterns: ["rent", "coned", "con ed", "electric", "gas", "internet", "water", "utility"] },
    { category: "Shopping", patterns: ["store", "retail", "uniqlo", "zara", "amazon", "mall", "purchase"] },
    { category: "Entertainment", patterns: ["movie", "theater", "broadway", "netflix", "spotify", "ticket", "concert"] },
    { category: "Healthcare", patterns: ["hospital", "pharmacy", "walgreens", "cvs", "doctor", "clinic", "medical"] },
    { category: "Travel", patterns: ["hotel", "airline", "flight", "airbnb", "booking", "expedia"] },
  ];

  const lowered = text.toLowerCase();
  const matched = rules.find((rule) => rule.patterns.some((pattern) => lowered.includes(pattern.toLowerCase())));
  return matched ? matched.category : "Other";
}

function setScanStatus(message, tone) {
  elements.scanStatus.textContent = message;
  elements.scanStatus.className = `callout ${tone}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
