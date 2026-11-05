/* =========================================================
   EXCELSO — INSTALL AS AN APP  —  v9.4
   Registers the app helper (sw.js) and shows an "Install app"
   button where the phone or computer supports it.
========================================================= */

(function () {

    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    let installPrompt = null;

    if (isStandalone) document.documentElement.classList.add("is-app");

    if ("serviceWorker" in navigator && location.protocol === "https:") {
        window.addEventListener("load", function () {
            navigator.serviceWorker.register("sw.js").catch(function () { /* the site still works without it */ });
        });
    }

    function buttons() { return document.querySelectorAll(".install-app-button"); }
    function show(on) { buttons().forEach(function (b) { b.hidden = !on; }); }

    window.addEventListener("beforeinstallprompt", function (event) {
        event.preventDefault();
        installPrompt = event;
        if (!isStandalone) show(true);
    });

    window.addEventListener("appinstalled", function () {
        installPrompt = null;
        show(false);
        if (typeof showNotification === "function") showNotification("Installed", "Excelso is on your home screen.");
    });

    document.addEventListener("DOMContentLoaded", function () {

        // iPhone / iPad Safari has no install prompt: show the button with instructions instead
        if (isIos && !isStandalone) show(true);

        buttons().forEach(function (button) {
            button.addEventListener("click", async function () {
                if (installPrompt) {
                    installPrompt.prompt();
                    await installPrompt.userChoice.catch(function () {});
                    installPrompt = null;
                    show(false);
                    return;
                }
                const tip = isIos
                    ? "In Safari, tap the Share button (square with an arrow), then \u201cAdd to Home Screen\u201d."
                    : "Open your browser menu (\u22ee) and choose \u201cInstall app\u201d or \u201cAdd to Home screen\u201d.";
                if (typeof showNotification === "function") showNotification("Install Excelso", tip);
                else alert(tip);
            });
        });

        // Home-screen shortcuts open a page directly (e.g. /?page=calendar)
        const page = new URLSearchParams(location.search).get("page");
        if (page) {
            const open = function () {
                if (typeof currentUser !== "undefined" && currentUser && typeof showPage === "function") showPage(page);
            };
            setTimeout(open, 600);
        }

    });

})();
