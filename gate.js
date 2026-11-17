// Rooted site password screen.
// Every page loads this file first, in <head>. Until the visitor enters the site
// password, the page is hidden and a password screen is shown instead.
// The password itself is stored in Supabase (Edge Functions → Secrets → SITE_PASSWORD)
// and checked by the rooted-login function, which hands back a pass for 30 days.
(function () {
  var LOGIN_URL = "https://wvghcoovpibfghwphgik.supabase.co/functions/v1/rooted-login";
  var KEY = "rootedPass";

  function getPass() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setPass(t) {
    try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) {}
  }
  // The pass says when it runs out; the server checks that it's genuine
  function notExpired(t) {
    try {
      var p = t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      while (p.length % 4) p += "=";
      return JSON.parse(atob(p)).exp * 1000 > Date.now();
    } catch (e) { return false; }
  }

  // Other pages (the AI chat) use this to send the pass along
  window.RootedGate = {
    pass: getPass,
    lock: function () { setPass(null); location.reload(); }
  };

  var style = document.createElement("style");
  style.textContent =
    "html.rooted-locked body > *:not(#rooted-gate){display:none !important}" +
    "#rooted-gate{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;" +
    "padding:16px;background:#c5c9c6;font-family:Georgia,'Times New Roman',serif;color:#222}" +
    "#rooted-gate form{width:100%;max-width:360px;background:#fff;border-radius:12px;padding:28px 24px;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}" +
    "#rooted-gate img{height:64px;width:auto;border-radius:8px;margin-bottom:10px}" +
    "#rooted-gate h1{font-size:26px;font-weight:normal;margin:0 0 4px}" +
    "#rooted-gate p.sub{color:#6b716d;font-size:15px;margin:0 0 18px}" +
    "#rooted-gate input{width:100%;box-sizing:border-box;font-family:inherit;font-size:16px;padding:12px;" +
    "border:1px solid #ccc;border-radius:10px;margin:0}" +
    "#rooted-gate input:focus-visible,#rooted-gate button:focus-visible{outline:2px solid #222;outline-offset:2px}" +
    "#rooted-gate button{width:100%;margin-top:12px;font-family:inherit;font-size:16px;background:#222;color:#fff;" +
    "border:none;border-radius:10px;height:48px;cursor:pointer}" +
    "#rooted-gate button:disabled{background:#888;cursor:default}" +
    "#rooted-gate .msg{margin:12px 0 0;font-size:14px;color:#8a3324;background:#f6e7e4;border-radius:8px;padding:9px 10px}";
  document.head.appendChild(style);

  function showGate() {
    document.documentElement.classList.add("rooted-locked");
    function build() {
      if (document.getElementById("rooted-gate")) return;
      var gate = document.createElement("div");
      gate.id = "rooted-gate";
      gate.innerHTML =
        '<form novalidate>' +
        '<img src="images/rooted-logo-white.jpg" alt="Rooted logo">' +
        '<h1>Rooted</h1>' +
        '<p class="sub">Enter the password to continue.</p>' +
        '<input type="password" autocomplete="current-password" aria-label="Password" placeholder="Password">' +
        '<button type="submit">Enter</button>' +
        '<p class="msg" role="status" hidden></p>' +
        '</form>';
      document.body.appendChild(gate);
      var form = gate.querySelector("form");
      var input = gate.querySelector("input");
      var btn = gate.querySelector("button");
      var msg = gate.querySelector(".msg");
      input.focus();

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!input.value) return;
        btn.disabled = true;
        msg.hidden = true;
        fetch(LOGIN_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({ password: input.value })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.token) throw new Error(data.error || "That password isn't right.");
            setPass(data.token);
            gate.remove();
            document.documentElement.classList.remove("rooted-locked");
          })
          .catch(function (err) {
            msg.textContent = err && err.message && err.message !== "Failed to fetch"
              ? err.message
              : "Couldn't check the password right now. Try again in a minute.";
            msg.hidden = false;
            input.select();
          })
          .then(function () { btn.disabled = false; });
      });
    }
    if (document.body) build();
    else document.addEventListener("DOMContentLoaded", build);
  }

  var pass = getPass();
  if (!pass || !notExpired(pass)) {
    setPass(null);
    showGate();
    return;
  }

  // Already entered: show the page right away, and check in the background
  // that the pass still works (it stops working if the password is changed).
  fetch(LOGIN_URL, { headers: { Authorization: "Bearer " + pass } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.valid === false) { setPass(null); showGate(); }
    })
    .catch(function () {});
})();
