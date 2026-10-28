/* =========================================================
   EXCELSO — AI FEATURES (frontend)  —  v8
   Loaded after script.js and uses its helpers (apiRequest,
   tasks, currentUser, openTaskDetailDrawer, ...).

   v8 adds two tabs for the Founder / Operations Head:
   - Find tasks in notes: upload or paste a meeting transcript or a
     WhatsApp chat; the AI lists the tasks discussed / assigned,
     each editable, with an "Add this task" toggle.
   - Knowledge base: general info, important notes, meeting notes
     and guidelines that the AI Assistant can answer from.

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

let aiTab = "chat";
const AI_EXTRACT_TIMEOUT_MS = 300000;   // long transcripts can take 1-3 minutes

const AI_SUGGESTIONS = [
    "What is overdue right now, and who owns each item?",
    "Summarise what changed across all tasks this week.",
    "How is each team member doing on their tasks?",
    "Which tasks haven't been updated in over two weeks?",
    "Which regular tasks were missed or not logged this week?",
    "What should the team focus on tomorrow?"
];

const AI_ADMIN_SUGGESTIONS = [
    "What did we decide in the most recent meeting notes?",
    "What do our guidelines say about packing and dispatch?"
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

    if (!isPrivilegedUser() && aiTab !== "chat") setAiTab("chat");

}

function resetAiState() {
    aiMessages = [];
    aiBusy = false;
    myInsight = null;
    aiTab = "chat";
    resetExtractState();
    kbNotes = null;
    kbLoading = false;
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
        .replace(/(^|[^A-Za-z0-9-])((?:T|BL|RT|KB)\d{3,})\b/g, function (m, pre, id) {
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

    if (/^KB/i.test(id)) {
        if (!isPrivilegedUser()) return showNotification("Can't open " + id, "Knowledge base notes are only for the Founder and Operations Head.");
        return openKbNoteById(id);
    }

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

    document.getElementById("aiTabs")?.addEventListener("click", function (event) {
        const tab = event.target.closest(".ai-tab");
        if (tab) setAiTab(tab.dataset.aiTab);
    });

    initializeExtract();
    initializeKnowledgeBase();

}

function setAiTab(tab) {

    if (tab !== "chat" && !isPrivilegedUser()) tab = "chat";
    aiTab = tab;

    document.querySelectorAll(".ai-tab").forEach(function (b) {
        const on = b.dataset.aiTab === tab;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
    });

    const panels = { chat: "aiPanelChat", extract: "aiPanelExtract", kb: "aiPanelKb" };
    Object.keys(panels).forEach(function (key) {
        const el = document.getElementById(panels[key]);
        if (el) el.hidden = key !== tab;
    });

    const newChat = document.getElementById("aiNewChatButton");
    if (newChat) newChat.style.display = tab === "chat" ? "" : "none";

    const intro = {
        chat: "Ask about tasks, updates, deadlines, changes or team performance. Answers come from the live data in Excelso.",
        extract: "Add a meeting transcript or a WhatsApp chat. The AI lists the tasks that were discussed or assigned — check them, edit them, and add the ones you want.",
        kb: "General info, important notes, meeting notes and guidelines. The AI Assistant answers from these when you ask."
    };
    setText("aiPageIntro", intro[tab]);

    if (tab === "chat") { renderAiMessages(); setTimeout(function () { document.getElementById("aiInput")?.focus(); }, 50); }
    if (tab === "kb") loadKnowledgeBase(false);

}

function renderAiPage() {
    initializeAiPage();
    if (!hasAiAccessClient()) return showPage("dashboard");
    setAiTab(aiTab);
}

function renderAiMessages() {

    const box = document.getElementById("aiMessages");
    if (!box) return;

    if (!aiMessages.length && !aiBusy) {
        const first = String(currentUser?.name || "").replace(/^(mr|mrs|ms|dr)\.?\s*/i, "").split(" ")[0];
        box.innerHTML = `
            <div class="ai-welcome">
                <h3>${first ? "Hi " + escapeHtml(first) + ", w" : "W"}hat would you like to know?</h3>
                <p>I can read every task, checklist, comment, regular-task update, the activity log and the backlog${isPrivilegedUser() ? ", plus the knowledge base" : ""}.</p>
                <div class="ai-suggestions">
                    ${(isPrivilegedUser() ? AI_SUGGESTIONS.slice(0, 4).concat(AI_ADMIN_SUGGESTIONS) : AI_SUGGESTIONS).map(function (q) {
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


/* =========================================================
   FILE READING (shared by the task finder and the knowledge base)
   .txt .md .vtt .srt .csv → text; .docx → text (mammoth);
   .zip (WhatsApp export) → the chat .txt inside; .pdf → base64.
========================================================= */

const loadedScripts = {};

function loadScriptOnce(url) {
    if (!loadedScripts[url]) {
        loadedScripts[url] = new Promise(function (resolve, reject) {
            const tag = document.createElement("script");
            tag.src = url;
            tag.onload = resolve;
            tag.onerror = function () { delete loadedScripts[url]; reject(new Error("Couldn't load a helper library. Check your internet connection.")); };
            document.head.appendChild(tag);
        });
    }
    return loadedScripts[url];
}

function fileExtension(name) {
    const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : "";
}

function readAsText(file) {
    return new Promise(function (resolve, reject) {
        const r = new FileReader();
        r.onload = function () { resolve(String(r.result || "")); };
        r.onerror = function () { reject(new Error("Couldn't read that file.")); };
        r.readAsText(file);
    });
}

function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
        const r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { reject(new Error("Couldn't read that file.")); };
        r.readAsArrayBuffer(file);
    });
}

function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
        const r = new FileReader();
        r.onload = function () { resolve(String(r.result || "").split(",")[1] || ""); };
        r.onerror = function () { reject(new Error("Couldn't read that file.")); };
        r.readAsDataURL(file);
    });
}

/* Subtitle files: drop cue numbers and timestamps, keep the words. */
function cleanSubtitleText(text) {
    return text.split(/\r?\n/).filter(function (line) {
        const t = line.trim();
        if (!t || t === "WEBVTT") return false;
        if (/^\d+$/.test(t)) return false;
        if (/-->/.test(t)) return false;
        return true;
    }).join("\n");
}

/* Returns { text } or { pdfBase64 }. */
async function readUploadedFile(file, options = {}) {

    const ext = fileExtension(file.name);

    if (ext === "pdf") {
        if (!options.allowPdf) throw new Error("PDFs can't be read here. Copy the text from the PDF and paste it instead.");
        if (file.size > 8 * 1024 * 1024) throw new Error("That PDF is larger than 8 MB. Export it as text or split it.");
        return { pdfBase64: await readAsBase64(file) };
    }

    if (ext === "docx") {
        await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
        const result = await window.mammoth.extractRawText({ arrayBuffer: await readAsArrayBuffer(file) });
        return { text: String(result.value || "").trim() };
    }

    if (ext === "zip") {
        await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
        const zip = await window.JSZip.loadAsync(await readAsArrayBuffer(file));
        const txt = Object.keys(zip.files).filter(function (n) { return /\.txt$/i.test(n) && !zip.files[n].dir; })
            .sort(function (a, b) { return (/chat/i.test(b) ? 1 : 0) - (/chat/i.test(a) ? 1 : 0); })[0];
        if (!txt) throw new Error("No chat .txt file inside that zip. In WhatsApp choose Export chat → Without media.");
        return { text: await zip.files[txt].async("string") };
    }

    if (ext === "doc") throw new Error("Old .doc files can't be read. Save it as .docx or paste the text.");

    const text = await readAsText(file);
    return { text: ext === "vtt" || ext === "srt" ? cleanSubtitleText(text) : text };

}

/* WhatsApp: keep only messages on or after `since` (yyyy-mm-dd).
   Handles "12/10/26, 9:41 pm - Name: ..." and "[12/10/2026, 21:41:05] Name: ...".
   Dates are read day-first (Indian phones) unless that's impossible. */
function filterWhatsAppSince(text, since) {

    const sinceDate = parseDate(since);
    if (!sinceDate) return text;

    const re = /^\u200e?\[?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})[,\s]/;
    let keep = false;
    let anyDated = false;
    const out = [];

    text.split(/\r?\n/).forEach(function (line) {
        const m = line.match(re);
        if (m) {
            anyDated = true;
            let a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
            if (y < 100) y += 2000;
            let day = a, month = b;
            if (b > 12 && a <= 12) { day = b; month = a; }
            const d = new Date(y, month - 1, day);
            keep = !isNaN(d.getTime()) && d >= sinceDate;
        }
        if (keep) out.push(line);
    });

    return anyDated ? out.join("\n") : text;

}


/* =========================================================
   FIND TASKS IN NOTES (Founder / Operations Head)
========================================================= */

let extractState = null;

function resetExtractState() {
    extractState = { sourceType: "meeting", fileName: "", pdfBase64: "", running: false, summary: "", savedNoteId: "", items: [], sourceLabel: "" };
}
resetExtractState();

function initializeExtract() {

    document.querySelectorAll("input[name='extractSource']").forEach(function (radio) {
        radio.addEventListener("change", function () {
            extractState.sourceType = radio.value;
            const wa = radio.value === "whatsapp";
            const since = document.getElementById("extractSinceGroup");
            if (since) since.hidden = !wa;
            setText("extractDropTitle", extractState.fileName ? extractState.fileName : "Drop a file here or choose one");
            const text = document.getElementById("extractText");
            if (text) text.placeholder = wa
                ? "Paste the WhatsApp messages, e.g. 12/10/26, 9:41 pm - Royston: Bhuvana, please send the Madurai stock list by Friday"
                : "Paste the meeting transcript or your meeting notes…";
        });
    });

    const fileInput = document.getElementById("extractFile");
    fileInput?.addEventListener("change", function () {
        if (fileInput.files && fileInput.files[0]) handleExtractFile(fileInput.files[0]);
        fileInput.value = "";
    });

    const drop = document.getElementById("extractDropzone");
    if (drop) {
        ["dragenter", "dragover"].forEach(function (type) {
            drop.addEventListener(type, function (event) { event.preventDefault(); drop.classList.add("is-dragging"); });
        });
        ["dragleave", "drop"].forEach(function (type) {
            drop.addEventListener(type, function (event) { event.preventDefault(); drop.classList.remove("is-dragging"); });
        });
        drop.addEventListener("drop", function (event) {
            const file = event.dataTransfer?.files?.[0];
            if (file) handleExtractFile(file);
        });
    }

    const textArea = document.getElementById("extractText");
    textArea?.addEventListener("input", updateExtractCharCount);

    document.getElementById("extractRunButton")?.addEventListener("click", runExtract);
    document.getElementById("extractClearButton")?.addEventListener("click", function () {
        if (extractState.running) return;
        const keepType = extractState.sourceType;
        resetExtractState();
        extractState.sourceType = keepType;
        setInput("extractText", "");
        setInput("extractLabel", "");
        setInput("extractSince", "");
        setText("extractDropTitle", "Drop a file here or choose one");
        document.getElementById("extractDropzone")?.classList.remove("has-file");
        showExtractError("");
        updateExtractCharCount();
        renderExtractResults();
    });

    const results = document.getElementById("extractResults");
    results?.addEventListener("input", onExtractFieldChange);
    results?.addEventListener("change", onExtractFieldChange);
    results?.addEventListener("click", onExtractClick);
    results?.addEventListener("ownerschange", function (event) {
        const card = event.target.closest(".extract-card");
        const item = card && findExtractItem(card.dataset.key);
        if (item && event.target._picker) { item.owners = event.target._picker.getList(); item.error = ""; updateExtractCardState(card, item); }
    });

}

function updateExtractCharCount() {
    const value = getInput("extractText");
    setText("extractCharCount", value ? value.length.toLocaleString("en-IN") + " characters" : "");
}

function showExtractError(message) {
    const box = document.getElementById("extractError");
    if (!box) return;
    box.textContent = message || "";
    box.style.display = message ? "block" : "none";
}

async function handleExtractFile(file) {

    showExtractError("");
    setText("extractDropTitle", "Reading " + file.name + "…");

    try {
        const ext = fileExtension(file.name);
        if (ext === "zip" || /whatsapp/i.test(file.name)) {
            const radio = document.querySelector("input[name='extractSource'][value='whatsapp']");
            if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event("change")); }
        }

        const result = await readUploadedFile(file, { allowPdf: true });
        extractState.fileName = file.name;
        extractState.pdfBase64 = result.pdfBase64 || "";

        if (result.text !== undefined) {
            if (!result.text.trim()) throw new Error("That file is empty.");
            setInput("extractText", result.text);
        } else {
            setInput("extractText", "");
        }

        if (!getInput("extractLabel")) setInput("extractLabel", file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " "));

        setText("extractDropTitle", file.name + (extractState.pdfBase64 ? " (PDF attached)" : ""));
        document.getElementById("extractDropzone")?.classList.add("has-file");
        updateExtractCharCount();
    }
    catch (error) {
        extractState.fileName = "";
        extractState.pdfBase64 = "";
        setText("extractDropTitle", "Drop a file here or choose one");
        showExtractError(error.message || "Couldn't read that file.");
    }

}

async function runExtract() {

    if (extractState.running) return;

    let text = getInput("extractText").trim();
    const since = getInput("extractSince");

    if (!text && !extractState.pdfBase64) return showExtractError("Paste the text or choose a file first.");

    if (extractState.sourceType === "whatsapp" && since && text) {
        const filtered = filterWhatsAppSince(text, since);
        if (!filtered.trim()) return showExtractError("No messages on or after " + displayDate(since) + ". Pick an earlier date.");
        text = filtered;
    }

    if (text.length > 250000) {
        return showExtractError("That's " + text.length.toLocaleString("en-IN") + " characters — too long for one go." +
            (extractState.sourceType === "whatsapp" ? " Use \"Only messages since\" to pick recent messages." : " Split it into parts."));
    }

    showExtractError("");
    extractState.running = true;
    extractState.items = [];
    extractState.summary = "";
    extractState.savedNoteId = "";
    extractState.sourceLabel = getInput("extractLabel").trim() || extractState.fileName ||
        (extractState.sourceType === "whatsapp" ? "WhatsApp chat" : "meeting notes");
    renderExtractResults();

    const button = document.getElementById("extractRunButton");
    setButtonLoading(button, true);

    const result = await apiRequest("aiExtractTasks", {
        sourceType: extractState.sourceType,
        text: text,
        pdfBase64: extractState.pdfBase64 && !text ? extractState.pdfBase64 : "",
        fileName: extractState.fileName,
        label: getInput("extractLabel").trim(),
        saveToKnowledge: !!document.getElementById("extractSaveKb")?.checked
    }, { timeoutMs: AI_EXTRACT_TIMEOUT_MS, silent: true });

    extractState.running = false;
    setButtonLoading(button, false);

    if (!result || !result.success) {
        showExtractError(result?.message || "The AI couldn't read that just now. Try again.");
        renderExtractResults();
        return;
    }

    extractState.summary = result.summary || "";
    extractState.savedNoteId = result.savedNoteId || "";
    extractState.items = (result.tasks || []).map(function (t) {
        return Object.assign({}, t, { selected: !t.duplicateOf, status: "idle", error: "", createdId: "" });
    });

    if (result.savedNoteId) kbNotes = null;   // reload the knowledge base next time

    renderExtractResults();
    document.getElementById("extractResults")?.scrollIntoView({ behavior: "smooth", block: "start" });

}

function findExtractItem(key) {
    return extractState.items.find(function (i) { return i.key === key; });
}

function extractDepartmentOptions(selected) {
    const list = DEPARTMENTS.slice();
    if (selected && list.indexOf(selected) === -1) list.push(selected);
    return `<option value="">Choose…</option>` + list.map(function (d) {
        return `<option value="${escapeHtml(d)}"${d === selected ? " selected" : ""}>${escapeHtml(d)}</option>`;
    }).join("");
}

function extractCardHtml(item) {

    if (item.status === "added") {
        return `
            <article class="extract-card is-added" data-key="${escapeHtml(item.key)}">
                <span class="extract-added-mark" aria-hidden="true">✓</span>
                <div class="extract-added-body">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>Added to ${item.destination === "backlog" ? "Backlog" : "Tasks"} as
                    <button type="button" class="ai-task-link" data-task-id="${escapeHtml(item.createdId)}">${escapeHtml(item.createdId)}</button></span>
                </div>
            </article>
        `;
    }

    const opt = function (value, label, current) { return `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`; };
    const saving = item.status === "saving";

    return `
        <article class="extract-card${item.selected ? " is-selected" : ""}" data-key="${escapeHtml(item.key)}">
            <div class="extract-card-head">
                <label class="switch">
                    <input type="checkbox" data-field="selected" ${item.selected ? "checked" : ""} ${saving ? "disabled" : ""}>
                    <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
                    <span class="switch-label">Add this ${item.destination === "backlog" ? "to backlog" : "task"}</span>
                </label>
                <select data-field="destination" class="extract-destination" aria-label="Add to">
                    ${opt("task", "As a task", item.destination)}
                    ${opt("backlog", "To backlog", item.destination)}
                </select>
            </div>

            ${item.duplicateOf ? `<p class="extract-duplicate">Looks like existing task
                <button type="button" class="ai-task-link" data-task-id="${escapeHtml(item.duplicateOf)}">${escapeHtml(item.duplicateOf)}</button>
                “${escapeHtml(item.duplicateTitle)}”. Turned off so it isn't added twice.</p>` : ""}

            <label class="sr-only" for="ex-title-${escapeHtml(item.key)}">Task title</label>
            <input type="text" id="ex-title-${escapeHtml(item.key)}" class="extract-title" data-field="title" value="${escapeHtml(item.title)}" maxlength="150">

            <label class="sr-only" for="ex-desc-${escapeHtml(item.key)}">Description</label>
            <textarea id="ex-desc-${escapeHtml(item.key)}" class="extract-description" data-field="description" rows="3">${escapeHtml(item.description)}</textarea>

            <div class="extract-card-grid">
                <div class="extract-field">
                    <span>Department</span>
                    <select data-field="department">${extractDepartmentOptions(item.department)}</select>
                </div>
                <div class="extract-field extract-field-owners">
                    <span>Owners</span>
                    <div class="owner-picker owner-picker-compact" data-owner-picker></div>
                </div>
                <div class="extract-field">
                    <span>Priority</span>
                    <select data-field="priority">${opt("High", "High", item.priority)}${opt("Medium", "Medium", item.priority)}${opt("Low", "Low", item.priority)}</select>
                </div>
                <div class="extract-field">
                    <span>${item.destination === "backlog" ? "Expected" : "Due date"}</span>
                    <input type="date" data-field="dueDate" value="${escapeHtml(item.dueDate)}">
                </div>
            </div>

            ${item.sourceQuote ? `<blockquote class="extract-quote">${escapeHtml(item.sourceQuote)}</blockquote>` : ""}

            <div class="extract-card-foot">
                <span class="extract-card-error" role="alert">${escapeHtml(item.error || "")}</span>
                <button type="button" class="secondary-button extract-add-one" ${saving ? "disabled" : ""}>${saving ? "Adding…" : "Add now"}</button>
            </div>
        </article>
    `;

}

function renderExtractResults() {

    const box = document.getElementById("extractResults");
    if (!box) return;

    if (extractState.running) {
        box.innerHTML = `
            <div class="panel extract-working">
                <span class="ai-dots"><i></i><i></i><i></i></span>
                <div>
                    <strong>Reading ${extractState.sourceType === "whatsapp" ? "the chat" : "the meeting"}…</strong>
                    <p>Long transcripts take a minute or two. Keep this tab open.</p>
                </div>
            </div>`;
        return;
    }

    if (!extractState.summary && !extractState.items.length) { box.innerHTML = ""; return; }

    const remaining = extractState.items.filter(function (i) { return i.status !== "added"; });
    const selectedCount = remaining.filter(function (i) { return i.selected; }).length;
    const addedCount = extractState.items.length - remaining.length;

    box.innerHTML = `
        <div class="panel extract-summary">
            <div class="extract-summary-head">
                <h3>${extractState.items.length ? extractState.items.length + " task" + (extractState.items.length === 1 ? "" : "s") + " found" : "No tasks found"}</h3>
                ${extractState.savedNoteId ? `<span class="extract-saved">Saved to knowledge base as
                    <button type="button" class="ai-task-link" data-task-id="${escapeHtml(extractState.savedNoteId)}">${escapeHtml(extractState.savedNoteId)}</button></span>` : ""}
            </div>
            ${extractState.summary ? `<p>${escapeHtml(extractState.summary)}</p>` : ""}
            ${!extractState.items.length ? `<p class="extract-empty-hint">Nothing in there reads like a task or assignment. If you expected some, check the right source type is selected and that the text includes who said what.</p>` : ""}
        </div>

        ${extractState.items.length ? `
            <div class="extract-bulk-bar">
                <div class="extract-bulk-select">
                    <button type="button" class="link-button" data-bulk="all">Select all</button>
                    <button type="button" class="link-button" data-bulk="none">Select none</button>
                    ${addedCount ? `<span>${addedCount} added</span>` : ""}
                </div>
                <button type="button" class="primary-button" id="extractAddSelected" ${selectedCount ? "" : "disabled"}>
                    Add ${selectedCount} selected
                </button>
            </div>
            <div class="extract-list">${extractState.items.map(extractCardHtml).join("")}</div>
        ` : ""}
    `;

    box.querySelectorAll(".extract-card").forEach(function (card) {
        const item = findExtractItem(card.dataset.key);
        const root = card.querySelector("[data-owner-picker]");
        if (!item || !root) return;
        const picker = createOwnerPicker(root);
        picker.setValue(joinOwners(item.owners || []));
        if (item.status === "saving") picker.setDisabled(true);
        extraOwnerPickers.push(picker);
    });

    // drop pickers whose cards are gone
    for (let i = extraOwnerPickers.length - 1; i >= 0; i--) {
        if (!document.body.contains(extraOwnerPickers[i].root)) extraOwnerPickers.splice(i, 1);
    }

}

function updateExtractCardState(card, item) {
    card.classList.toggle("is-selected", !!item.selected);
    const err = card.querySelector(".extract-card-error");
    if (err) err.textContent = item.error || "";
    const label = card.querySelector(".switch-label");
    if (label) label.textContent = "Add this " + (item.destination === "backlog" ? "to backlog" : "task");
    updateExtractBulkButton();
}

function updateExtractBulkButton() {
    const button = document.getElementById("extractAddSelected");
    if (!button) return;
    const count = extractState.items.filter(function (i) { return i.status !== "added" && i.selected; }).length;
    button.textContent = "Add " + count + " selected";
    button.disabled = !count;
}

function onExtractFieldChange(event) {
    const field = event.target.dataset?.field;
    if (!field) return;
    const card = event.target.closest(".extract-card");
    const item = card && findExtractItem(card.dataset.key);
    if (!item) return;

    item[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    item.error = "";

    if (field === "destination" && event.type === "change") {
        // re-render this card so labels match
        const fresh = document.createElement("div");
        fresh.innerHTML = extractCardHtml(item);
        const node = fresh.firstElementChild;
        card.replaceWith(node);
        const root = node.querySelector("[data-owner-picker]");
        if (root) { const p = createOwnerPicker(root); p.setValue(joinOwners(item.owners || [])); extraOwnerPickers.push(p); }
        updateExtractBulkButton();
        return;
    }

    updateExtractCardState(card, item);
}

function onExtractClick(event) {

    const bulk = event.target.closest("[data-bulk]");
    if (bulk) {
        const on = bulk.dataset.bulk === "all";
        extractState.items.forEach(function (i) { if (i.status !== "added") i.selected = on; });
        renderExtractResults();
        return;
    }

    if (event.target.closest("#extractAddSelected")) {
        addExtractItems(extractState.items.filter(function (i) { return i.status !== "added" && i.selected; }));
        return;
    }

    const one = event.target.closest(".extract-add-one");
    if (one) {
        const item = findExtractItem(one.closest(".extract-card").dataset.key);
        if (item) addExtractItems([item]);
    }

}

function validateExtractItem(item) {
    if (!String(item.title || "").trim()) return "Add a title.";
    if (item.destination !== "backlog") {
        if (!item.department) return "Choose a department.";
        if (!item.owners || !item.owners.length) return "Choose at least one owner.";
    }
    return "";
}

async function addExtractItems(items) {

    if (!items.length || isRequestActive("extractAdd")) return;

    let invalid = 0;
    items.forEach(function (item) { item.error = validateExtractItem(item); if (item.error) invalid++; });

    const valid = items.filter(function (i) { return !i.error; });
    if (!valid.length) {
        renderExtractResults();
        return showNotification("Not added", invalid === 1 ? "Fill in the highlighted task first." : "Fill in the highlighted tasks first.");
    }

    valid.forEach(function (i) { i.status = "saving"; });
    renderExtractResults();

    let result = null;
    await guardAsync("extractAdd", async function () {
        result = await apiRequest("createTasksBulk", {
            sourceLabel: extractState.sourceLabel,
            tasks: valid.map(function (i) {
                return {
                    clientKey: i.key,
                    task: i.title.trim(),
                    description: i.description,
                    department: i.department,
                    assignedTo: joinOwners(i.owners || []),
                    priority: i.priority,
                    dueDate: i.dueDate,
                    destination: i.destination
                };
            })
        }, { timeoutMs: 90000 });
    });

    if (!result || !result.success) {
        valid.forEach(function (i) { i.status = "idle"; i.error = result?.message || "Couldn't add it. Press ↻ to check before trying again."; });
        renderExtractResults();
        return showNotification("Not added", result?.message || "Couldn't add the tasks.");
    }

    let created = 0;
    (result.results || []).forEach(function (r) {
        const item = findExtractItem(r.clientKey);
        if (!item) return;
        if (r.success) {
            item.status = "added";
            item.createdId = r.id;
            created++;
            if (r.task) upsertLocalTask(r.task);
            if (r.item) { backlogTasks.push(r.item); lastSignature = ""; persistLocalCacheSoon(); }
        } else {
            item.status = "idle";
            item.error = r.message || "Couldn't add it.";
        }
    });

    renderExtractResults();
    showNotification(created ? "Added" : "Not added",
        created + " of " + valid.length + " added" + (invalid ? ". " + invalid + " need details first." : "."));

}


/* =========================================================
   KNOWLEDGE BASE (Founder / Operations Head)
========================================================= */

let kbNotes = null;
let kbCategories = ["General Info", "Important Notes", "Meeting Notes", "Guidelines", "WhatsApp Chats"];
let kbLoading = false;

function initializeKnowledgeBase() {

    document.getElementById("kbAddButton")?.addEventListener("click", function () { openKbNoteModal(null); });
    document.getElementById("kbSearch")?.addEventListener("input", debounce(renderKnowledgeBase, 150));
    document.getElementById("kbCategoryFilter")?.addEventListener("change", renderKnowledgeBase);

    document.getElementById("kbList")?.addEventListener("click", function (event) {
        const card = event.target.closest(".kb-card");
        if (card) openKbNoteById(card.dataset.id);
        const retry = event.target.closest(".kb-retry");
        if (retry) loadKnowledgeBase(true);
    });

    document.getElementById("kbNoteForm")?.addEventListener("submit", function (event) {
        event.preventDefault();
        saveKbNote();
    });

    document.getElementById("kbNoteDeleteButton")?.addEventListener("click", deleteKbNote);

    const content = document.getElementById("kbNoteContent");
    content?.addEventListener("input", updateKbMeta);

    const file = document.getElementById("kbNoteFile");
    file?.addEventListener("change", async function () {
        const f = file.files && file.files[0];
        file.value = "";
        if (!f) return;
        try {
            const res = await readUploadedFile(f, { allowPdf: false });
            const existing = getInput("kbNoteContent").trim();
            setInput("kbNoteContent", existing ? existing + "\n\n" + res.text : res.text);
            if (!getInput("kbNoteTitle").trim()) setInput("kbNoteTitle", f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " "));
            updateKbMeta();
        } catch (error) {
            showKbError(error.message);
        }
    });

}

async function loadKnowledgeBase(force) {

    if (!isPrivilegedUser()) return;
    if (kbLoading) return;
    if (kbNotes && !force) { renderKnowledgeBase(); return; }

    kbLoading = true;
    renderKnowledgeBase();

    const result = await apiRequest("getKnowledgeBase", {}, { silent: true });
    kbLoading = false;

    if (result && result.success) {
        kbNotes = result.notes || [];
        if (Array.isArray(result.categories) && result.categories.length) kbCategories = result.categories;
    } else if (!kbNotes) {
        kbNotes = null;
        const list = document.getElementById("kbList");
        if (list) list.innerHTML = `<div class="empty-state">${escapeHtml(result?.message || "Couldn't load the knowledge base.")} <button type="button" class="link-button kb-retry">Try again</button></div>`;
        return;
    }

    renderKnowledgeBase();

}

function fillKbCategorySelects() {
    const filter = document.getElementById("kbCategoryFilter");
    if (filter) {
        const prev = filter.value;
        filter.innerHTML = `<option value="">All categories</option>` + kbCategories.map(function (c) {
            return `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
        }).join("");
        filter.value = prev;
    }
    const select = document.getElementById("kbNoteCategory");
    if (select) select.innerHTML = kbCategories.map(function (c) { return `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`; }).join("");
}

function renderKnowledgeBase() {

    const list = document.getElementById("kbList");
    if (!list) return;

    fillKbCategorySelects();
    setText("kbCountBadge", kbNotes && kbNotes.length ? String(kbNotes.length) : "");

    if (!kbNotes) {
        list.innerHTML = kbLoading ? `<div class="skeleton-card-grid">${skeletonCards(3)}</div>` : "";
        return;
    }

    const query = getInput("kbSearch").trim().toLowerCase();
    const category = getInput("kbCategoryFilter");

    const shown = kbNotes.filter(function (n) {
        if (category && n.category !== category) return false;
        if (!query) return true;
        return (n.noteId + " " + n.title + " " + n.tags + " " + n.content).toLowerCase().indexOf(query) !== -1;
    });

    if (!kbNotes.length) {
        list.innerHTML = `<div class="empty-state kb-empty">
            <strong>No notes yet</strong>
            <p>Add company info, guidelines and meeting notes here, then ask the AI Assistant about them.</p>
        </div>`;
        return;
    }

    if (!shown.length) {
        list.innerHTML = `<div class="empty-state">No notes match that search.</div>`;
        return;
    }

    list.innerHTML = shown.map(function (n) {
        const preview = String(n.content || "").replace(/\s+/g, " ").trim().substring(0, 220);
        const when = n.updatedDate || n.createdDate;
        return `
            <button type="button" class="kb-card" data-id="${escapeHtml(n.noteId)}">
                <span class="kb-card-top">
                    <span class="kb-category kb-category-${escapeHtml(String(n.category).toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(n.category)}</span>
                    <span class="kb-id">${escapeHtml(n.noteId)}</span>
                </span>
                <strong class="kb-card-title">${escapeHtml(n.title)}</strong>
                <span class="kb-card-preview">${escapeHtml(preview)}${n.content && n.content.length > 220 ? "…" : ""}</span>
                <span class="kb-card-foot">${when ? escapeHtml(displayDate(when)) : ""}${n.updatedBy || n.createdBy ? ", " + escapeHtml(n.updatedBy || n.createdBy) : ""}${n.tags ? `<span class="kb-tags">${escapeHtml(n.tags)}</span>` : ""}</span>
            </button>
        `;
    }).join("");

}

async function openKbNoteById(id) {
    if (!kbNotes) await loadKnowledgeBase(true);
    const note = (kbNotes || []).find(function (n) { return n.noteId === id; });
    if (!note) return showNotification("Not found", id + " isn't in the knowledge base any more.");
    openKbNoteModal(note);
}

function showKbError(message) {
    const box = document.getElementById("kbNoteFormError");
    if (!box) return;
    box.textContent = message || "";
    box.style.display = message ? "block" : "none";
}

function updateKbMeta() {
    const length = getInput("kbNoteContent").length;
    setText("kbNoteMeta", length ? length.toLocaleString("en-IN") + " characters" : "");
}

function openKbNoteModal(note) {

    fillKbCategorySelects();
    showKbError("");

    setText("kbNoteModalTitle", note ? note.title : "New note");
    setText("kbNoteModalLabel", note ? note.noteId + ", " + note.category : "Knowledge base");
    setInput("kbNoteId", note ? note.noteId : "");
    setInput("kbNoteTitle", note ? note.title : "");
    setInput("kbNoteCategory", note ? note.category : (getInput("kbCategoryFilter") || "General Info"));
    setInput("kbNoteTags", note ? note.tags : "");
    setInput("kbNoteContent", note ? note.content : "");
    updateKbMeta();

    const del = document.getElementById("kbNoteDeleteButton");
    if (del) del.style.display = note ? "" : "none";

    if (typeof openAdminModal === "function") openAdminModal("kbNoteModal");
    setTimeout(function () { document.getElementById(note ? "kbNoteContent" : "kbNoteTitle")?.focus(); }, 60);

}

async function saveKbNote() {

    const payload = {
        noteId: getInput("kbNoteId"),
        title: getInput("kbNoteTitle").trim(),
        category: getInput("kbNoteCategory"),
        tags: getInput("kbNoteTags").trim(),
        content: getInput("kbNoteContent")
    };

    if (!payload.title) return showKbError("Give the note a title.");
    if (!payload.content.trim()) return showKbError("The note is empty.");

    const button = document.getElementById("kbNoteSaveButton");
    setButtonLoading(button, true);
    let result = null;
    await guardAsync("kbSave", async function () {
        result = await apiRequest("saveKnowledgeNote", payload, { timeoutMs: 60000 });
    });
    setButtonLoading(button, false);

    if (!result || !result.success) return showKbError(result?.message || "Couldn't save the note.");

    kbNotes = result.notes || kbNotes;
    closeAdminModal("kbNoteModal");
    showNotification("Saved", "Note " + result.noteId + " saved.");
    renderKnowledgeBase();

}

async function deleteKbNote() {

    const id = getInput("kbNoteId");
    if (!id) return;
    if (!confirm("Delete note " + id + " \u201c" + getInput("kbNoteTitle") + "\u201d? This removes it from the Knowledge Base sheet.")) return;

    let result = null;
    await guardAsync("kbDelete", async function () {
        result = await apiRequest("deleteKnowledgeNote", { noteId: id });
    });

    if (!result || !result.success) return showKbError(result?.message || "Couldn't delete the note.");

    kbNotes = result.notes || (kbNotes || []).filter(function (n) { return n.noteId !== id; });
    closeAdminModal("kbNoteModal");
    showNotification("Deleted", "Note " + id + " deleted.");
    renderKnowledgeBase();

}
