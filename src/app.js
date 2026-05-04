const sampleCsv = `account,plan,mrr,invoice_status,days_overdue,usage_percent,last_login_days,support_tickets,renewal_days,owner
Nimbus Foods,Growth,1850,paid,0,91,2,1,44,Ava
Vertex Bio,Enterprise,6400,overdue,18,74,5,4,21,Mateo
CraftDesk,Starter,79,paid,0,18,43,0,120,Lina
Signal Forge,Growth,2400,failed,35,66,12,6,15,Ava
BrightCart,Growth,1320,paid,0,104,1,2,67,Noah
LegalNorth,Enterprise,8100,paid,0,22,31,3,29,Mateo
PaperTrail,Starter,149,overdue,9,87,4,1,88,Lina
OmniField,Enterprise,5600,paid,0,97,3,0,11,Noah
Loopline,Growth,980,failed,41,13,38,7,9,Ava
RentPilot,Starter,199,paid,0,112,1,0,150,Lina`;

let currentReport = "";
let state = {
  mode: "operator",
  threshold: 62,
  accounts: [],
  scored: [],
};

function parseCsv(csv) {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  });
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

function asNumber(value) {
  const parsed = Number(String(value).replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return `$${Math.round(value).toLocaleString()}`;
}

function scoreAccount(row) {
  const mrr = asNumber(row.mrr);
  const daysOverdue = asNumber(row.days_overdue);
  const usage = asNumber(row.usage_percent);
  const lastLogin = asNumber(row.last_login_days);
  const tickets = asNumber(row.support_tickets);
  const renewalDays = asNumber(row.renewal_days);
  const invoiceStatus = String(row.invoice_status || "").toLowerCase();
  const signals = [];

  let risk = 20;
  if (invoiceStatus === "failed") {
    risk += 28;
    signals.push("failed payment");
  } else if (invoiceStatus === "overdue") {
    risk += 18;
    signals.push("overdue invoice");
  }

  if (daysOverdue >= 30) {
    risk += 18;
    signals.push("30+ days overdue");
  }

  if (usage < 25) {
    risk += 22;
    signals.push("low product usage");
  } else if (usage > 95) {
    signals.push("usage above plan fit");
  }

  if (lastLogin > 30) {
    risk += 16;
    signals.push("inactive users");
  }

  if (tickets >= 5) {
    risk += 14;
    signals.push("high support load");
  }

  if (renewalDays <= 30) {
    risk += 16;
    signals.push("renewal soon");
  }

  if (mrr >= 5000) {
    risk += 8;
    signals.push("large account");
  }

  const expansion = usage >= 90 && invoiceStatus === "paid" && lastLogin <= 7;
  const action = chooseAction({
    invoiceStatus,
    daysOverdue,
    usage,
    lastLogin,
    tickets,
    renewalDays,
    expansion,
    risk,
  });

  return {
    ...row,
    mrr,
    daysOverdue,
    usage,
    lastLogin,
    tickets,
    renewalDays,
    invoiceStatus,
    risk: Math.min(risk, 99),
    expansion,
    signals: signals.length ? signals : ["healthy baseline"],
    action,
  };
}

function chooseAction(account) {
  if (account.invoiceStatus === "failed") return "Recover payment";
  if (account.daysOverdue >= 7) return "Resolve invoice";
  if (account.risk >= state.threshold && account.renewalDays <= 30) return "Save renewal";
  if (account.usage < 25) return "Trigger activation";
  if (account.expansion) return "Offer upgrade";
  if (account.tickets >= 5) return "Escalate success review";
  return "Monitor";
}

function analyze() {
  state.accounts = parseCsv(document.querySelector("#csvInput").value);
  state.scored = state.accounts.map(scoreAccount).sort((a, b) => b.risk - a.risk || b.mrr - a.mrr);
  render();
}

function getSummary() {
  const riskAccounts = state.scored.filter((account) => account.risk >= state.threshold);
  const revenueAtRisk = riskAccounts.reduce((sum, account) => sum + account.mrr, 0);
  const billingIssues = state.scored.filter((account) =>
    ["failed", "overdue"].includes(account.invoiceStatus)
  );
  const expansionLeads = state.scored.filter((account) => account.expansion);
  return { riskAccounts, revenueAtRisk, billingIssues, expansionLeads };
}

function sentenceForMode(summary) {
  if (state.mode === "finance") {
    return `${formatMoney(summary.revenueAtRisk)} in MRR needs collection or renewal attention before it becomes leakage.`;
  }
  if (state.mode === "growth") {
    return `${summary.expansionLeads.length} accounts show upgrade potential from high usage and recent activity.`;
  }
  return `${summary.riskAccounts.length} accounts need owner action based on billing, usage, renewal, or support signals.`;
}

function buildReport() {
  const summary = getSummary();
  const topRisks = summary.riskAccounts.slice(0, 4);
  const topExpansion = summary.expansionLeads.slice(0, 3);
  const billingNames = summary.billingIssues.map((account) => account.account).join(", ") || "none";

  const riskLines = topRisks.length
    ? topRisks
        .map(
          (account) =>
            `- ${account.account}: risk ${account.risk}, ${formatMoney(account.mrr)} MRR, ${account.signals.join(", ")}. Action: ${account.action}.`
        )
        .join("\n")
    : "- No accounts are above the current risk threshold.";

  const expansionLines = topExpansion.length
    ? topExpansion
        .map(
          (account) =>
            `- ${account.account}: ${account.usage}% usage, ${formatMoney(account.mrr)} MRR, owner ${account.owner}.`
        )
        .join("\n")
    : "- No expansion leads are currently above signal thresholds.";

  currentReport = `# Revenue CSV Copilot Report

## Executive summary
${sentenceForMode(summary)}

## Priority risks
${riskLines}

## Billing queue
Accounts needing billing follow-up: ${billingNames}.

## Expansion leads
${expansionLines}

## Suggested operating rhythm
- Start with failed payments and renewals inside 30 days.
- Review low-usage accounts before sending renewal reminders.
- Export this report into CRM tasks grouped by owner.`;

  return currentReport;
}

function renderStats() {
  const summary = getSummary();
  document.querySelector("#rowsMetric").textContent = state.scored.length;
  document.querySelector("#riskMetric").textContent = formatMoney(summary.revenueAtRisk);
  document.querySelector("#billingMetric").textContent = summary.billingIssues.length;
  document.querySelector("#expansionMetric").textContent = summary.expansionLeads.length;
  document.querySelector("#actionCount").textContent = `${state.scored.length} accounts`;
}

function renderReport() {
  const report = buildReport();
  document.querySelector("#reportOutput").innerHTML = markdownToHtml(report);
  document.querySelector("#reportStatus").textContent = `${state.mode} mode`;
}

function markdownToHtml(markdown) {
  return markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h4>${line.slice(2)}</h4>`;
      if (line.startsWith("## ")) return `<h5>${line.slice(3)}</h5>`;
      if (line.startsWith("- ")) return `<p class="bullet">${line.slice(2)}</p>`;
      if (!line.trim()) return "";
      return `<p>${line}</p>`;
    })
    .join("");
}

function renderRows() {
  const tbody = document.querySelector("#accountRows");
  tbody.innerHTML = state.scored
    .map((account) => {
      const riskClass =
        account.risk >= 75 ? "danger" : account.risk >= state.threshold ? "warning" : "steady";
      return `
        <tr>
          <td>
            <strong>${account.account}</strong>
            <span>${account.plan} - ${formatMoney(account.mrr)} MRR</span>
          </td>
          <td><span class="risk ${riskClass}">${account.risk}</span></td>
          <td>${account.signals[0]}</td>
          <td>${account.action}</td>
        </tr>
      `;
    })
    .join("");
}

function render() {
  renderStats();
  renderReport();
  renderRows();
}

function downloadReport() {
  if (!currentReport) buildReport();
  const url = URL.createObjectURL(new Blob([currentReport], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "revenue-csv-copilot-report.md";
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  document.querySelector("#loadSample").addEventListener("click", () => {
    document.querySelector("#csvInput").value = sampleCsv;
    analyze();
  });

  document.querySelector("#analyze").addEventListener("click", analyze);

  document.querySelector("#downloadReport").addEventListener("click", downloadReport);

  document.querySelector("#reportMode").addEventListener("change", (event) => {
    state.mode = event.target.value;
    renderReport();
  });

  document.querySelector("#riskThreshold").addEventListener("input", (event) => {
    state.threshold = asNumber(event.target.value);
    state.scored = state.accounts.map(scoreAccount).sort((a, b) => b.risk - a.risk || b.mrr - a.mrr);
    render();
  });
}

document.querySelector("#csvInput").value = sampleCsv;
bindEvents();
analyze();
