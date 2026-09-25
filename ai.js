/* =========================================================
   EXCELSO — AI FEATURES (frontend)
   Loaded after script.js and uses its helpers (apiRequest,
   tasks, currentUser, openTaskDetailDrawer, ...).

   - AI Assistant: chat about all tasks and updates
   - My check-in: short personal message on the dashboard,
     for EVERY user, about their own tasks only

   The Claude API key never reaches the browser: every AI call
   goes through the Apps Script backend (AI.gs), which also checks
   who is allowed to use the AI.
========================================================= */

const AI_TIMEOUT_MS = 120000; // AI answers can take 10-60 seconds

let aiMessages = [];            // { role: "user"|"assistant"|"error", content }
let aiBusy = false;
let aiInitialized = false;


let myInsight = null;
let insightLoading = false;

const AI_SUGGESTIONS = [
    "What is overdue right now, and who owns each item?",
    "Summarise what changed across all tasks this week.",
    "How is each team member doing on their tasks?",
    "Which tasks haven't been updated in over two weeks?",
    "Which regular tasks were missed or not logged this week?",
    "What should the team focus on tomorrow?"
];

/* =========================================================
   ACCESS
========================================================= */

function hasAiAccessClient() {
    return !!(currentUser && currentUser.aiAccess);
}

function applyAiAccess() {

    const allowed = hasAiAccessClient();

    document.querySelectorAll(".nav-ai-only").forEach(function (el) {
        el.style.display = allowed ? "" : "none";
    });

    if (!allowed && currentPage === "ai") showPage("dashboard");

}

function resetAiState() {
    aiMessages = [];
    aiBusy = false;
    myInsight = null;
    const card = document.getElementById("myInsightCard");
    if (card) { card.style.display = "none"; card.innerHTML = ""; }
    document.querySelectorAll(".nav-ai-only").forEach(function (el) { el.style.display = "none"; });
}

/* =========================================================
   SAFE MINI-MARKDOWN (for AI answers)
   Escapes everything first, then allows: ### headings, bullet
   and numbered lists, **bold**, `code`, and clickable task IDs.
========================================================= */

function aiInline(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/(^|[^A-Za-z0-9-])((?:T|BL|RT)\d{3,})\b/g, function (m, pre, id) {
            return pre + `<button type="button" class="ai-task-link" data-task-id="${id}">${id}</button>`;
        });
}

function renderMarkdownLite(raw) {

    const lines = escapeHtml(raw).split(/\r?\n/);
    let html = "";
    let listType = null;

    const closeList = function () {
        if (listType) { html += `</${listType}>`; listType = null; }
    };

    const openList = function (type) {
        if (listType !== type) { closeList(); html += `<${type}>`; listType = type; }
    };

    lines.forEach(function (line) {

        let m;

        if ((m = line.match(/^\s*#{1,6}\s+(.*)$/))) {
            closeList();
            html += `<h4>${aiInline(m[1])}</h4>`;
        } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
            openList("ul");
            html += `<li>${aiInline(m[1])}</li>`;
        } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
            openList("ol");
            html += `<li>${aiInline(m[1])}</li>`;
        } else if (!line.trim()) {
            closeList();
        } else if (/^\s*\|/.test(line)) {
            closeList();
            html += `<p class="ai-table-line">${aiInline(line)}</p>`;
        } else {
            closeList();
            html += `<p>${aiInline(line)}</p>`;
        }

    });

    closeList();
    return html;

}

/* Opens whatever a task ID in an AI answer points to. */
function openAiTaskLink(id) {

    if (tasks.some(function (t) { return t.taskId === id; })) return openTaskDetailDrawer(id);

    if (/^BL/i.test(id) && typeof backlogTasks !== "undefined" && backlogTasks.some(function (b) { return b.backlogId === id; })) {
        return openBacklogDetailDrawer(id);
    }

    if (/^RT/i.test(id) && typeof regularTasks !== "undefined" && regularTasks.some(function (r) { return r.regularTaskId === id; })) {
        return openRegularTaskUpdate(id);
    }

    showNotification("Can't open " + id, "This item isn't in your view. Ask the Founder or Operations Head for access.");

}

document.addEventListener("click", function (event) {
    const link = event.target.closest(".ai-task-link");
    if (link) openAiTaskLink(link.dataset.taskId);
});

/* =========================================================
   AI ASSISTANT (chat)
========================================================= */

function initializeAiPage() {

    if (aiInitialized) return;
    aiInitialized = true;

    const form = document.getElementById("aiForm");
    const input = document.getElementById("aiInput");

    form?.addEventListener("submit", function (event) {
        event.preventDefault();
        sendAiQuestion(input.value);
    });

    input?.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendAiQuestion(input.value);
        }
    });

    // Grow the box as the question gets longer.
    input?.addEventListener("input", function () {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 180) + "px";
    });

    document.getElementById("aiNewChatButton")?.addEventListener("click", function () {
        if (aiBusy) return;
        aiMessages = [];
        renderAiMessages();
        input?.focus();
    });

    document.getElementById("aiMessages")?.addEventListener("click", function (event) {
        const chip = event.target.closest(".ai-suggestion");
        if (chip) { sendAiQuestion(chip.dataset.question); return; }
        const retry = event.target.closest(".ai-retry");
        if (retry) retryLastAiQuestion();
    });

}

function renderAiPage() {
    initializeAiPage();
    if (!hasAiAccessClient()) return showPage("dashboard");
    renderAiMessages();
    setTimeout(function () { document.getElementById("aiInput")?.focus(); }, 50);
}

function renderAiMessages() {

    const box = document.getElementById("aiMessages");
    if (!box) return;

    if (!aiMessages.length && !aiBusy) {
        const first = String(currentUser?.name || "").replace(/^(mr|mrs|ms|dr)\.?\s*/i, "").split(" ")[0];
        box.innerHTML = `
            <div class="ai-welcome">
                <h3>${first ? "Hi " + escapeHtml(first) + ", w" : "W"}hat would you like to know?</h3>
                <p>I can read every task, checklist, comment, regular-task update, the activity log and the backlog.</p>
                <div class="ai-suggestions">
                    ${AI_SUGGESTIONS.map(function (q) {
                        return `<button type="button" class="ai-suggestion" data-question="${escapeHtml(q)}">${escapeHtml(q)}</button>`;
                    }).join("")}
                </div>
            </div>
        `;
        return;
    }

    box.innerHTML = aiMessages.map(function (m) {
        if (m.role === "user") return `<div class="ai-msg ai-msg-user"><div class="ai-bubble">${escapeHtml(m.content)}</div></div>`;
        if (m.role === "error") {
            return `<div class="ai-msg ai-msg-error"><div class="ai-bubble">${escapeHtml(m.content)}
                <button type="button" class="ai-retry">Try again</button></div></div>`;
        }
        return `<div class="ai-msg ai-msg-assistant"><div class="ai-bubble ai-answer">${renderMarkdownLite(m.content)}</div></div>`;
    }).join("") + (aiBusy ? `
        <div class="ai-msg ai-msg-assistant">
            <div class="ai-bubble ai-thinking"><span class="ai-dots"><i></i><i></i><i></i></span> Reading tasks and updates…</div>
        </div>` : "");

    box.scrollTop = box.scrollHeight;

}

async function sendAiQuestion(text) {

    const question = String(text || "").trim();
    if (!question || aiBusy) return;

    const input = document.getElementById("aiInput");
    if (input) { input.value = ""; input.style.height = ""; }

    // Previous turns (not errors) so follow-up questions have context.
    const history = aiMessages
        .filter(function (m) { return m.role === "user" || m.role === "assistant"; })
        .slice(-8)
        .map(function (m) { return { role: m.role, content: m.content }; });

    aiMessages.push({ role: "user", content: question });
    aiBusy = true;
    renderAiMessages();

    const button = document.getElementById("aiSendButton");
    setButtonLoading(button, true);

    const result = await apiRequest("aiAsk", { question: question, history: history }, { timeoutMs: AI_TIMEOUT_MS, silent: true });

    aiBusy = false;
    setButtonLoading(button, false);

    if (result && result.success) {
        aiMessages.push({ role: "assistant", content: result.answer });
    } else {
        aiMessages.push({ role: "error", content: result?.message || "The AI couldn't answer just now.", question: question });
    }

    renderAiMessages();
    input?.focus();

}

function retryLastAiQuestion() {
    const last = aiMessages[aiMessages.length - 1];
    if (!last || last.role !== "error") return;
    aiMessages.pop();                     // remove the error
    const q = aiMessages.pop();           // remove the question; it's re-added on send
    sendAiQuestion(q ? q.content : last.question);
}

/* =========================================================
   MY CHECK-IN (every user, own tasks only)
========================================================= */

function insightCacheKey() {
    return "usedbookrInsight:" + String(currentUser?.username || "").toLowerCase() + ":" + todayInput();
}

async function loadMyInsight(force) {

    if (!currentUser || insightLoading) return;

    if (!force) {
        try {
            const cached = sessionStorage.getItem(insightCacheKey());
            if (cached) { myInsight = JSON.parse(cached); renderInsightCard(); return; }
        } catch (e) { /* ignore */ }
        if (myInsight) { renderInsightCard(); return; }
    }

    insightLoading = true;
    renderInsightCard();

    const result = await apiRequest("getMyInsight", force ? { refresh: true } : {}, { timeoutMs: 60000, silent: true });

    insightLoading = false;

    if (result && result.success && result.insight) {
        myInsight = result.insight;
        try { sessionStorage.setItem(insightCacheKey(), JSON.stringify(myInsight)); } catch (e) { /* ignore */ }
    }

    renderInsightCard();

}

function renderInsightCard() {

    const card = document.getElementById("myInsightCard");
    if (!card || !currentUser) return;

    if (!myInsight && !insightLoading) { card.style.display = "none"; return; }

    card.style.display = "";

    if (!myInsight) {
        card.innerHTML = `
            <div class="insight-head"><span class="insight-title">Your check-in</span></div>
            <div class="skeleton-bar" style="width:85%;"></div>
            <div class="skeleton-bar" style="width:60%; margin-top:8px;"></div>
        `;
        return;
    }

    const s = myInsight.stats || {};
    const pill = function (label, value, tone) {
        return `<span class="insight-pill${tone && value ? " insight-pill-" + tone : ""}"><strong>${value || 0}</strong> ${label}</span>`;
    };

    card.innerHTML = `
        <div class="insight-head">
            <span class="insight-title">Your check-in</span>
            <span class="insight-time">${escapeHtml(myInsight.generatedAt || "")}</span>
        </div>
        <p class="insight-message">${aiInline(escapeHtml(myInsight.message || ""))}</p>
        <div class="insight-pills">
            ${pill("overdue", s.overdue, "danger")}
            ${pill("due in 3 days", s.dueSoon, "warn")}
            ${pill("in progress", s.inProgress)}
            ${pill("open", s.open)}
            ${pill("on hold", s.onHold)}
            ${pill("not updated 10+ days", s.stale, "warn")}
            ${s.regularTasks ? pill("regular-task updates this week", s.regularUpdates7d) : ""}
        </div>
    `;

}
