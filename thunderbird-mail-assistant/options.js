"use strict";

const $ = (id) => document.getElementById(id);

async function charger() {
  const c = (await browser.storage.local.get("config")).config || {};
  $("f-apikey").value = c.apiKey || "";
  $("f-modele").value = c.modele || "mistral-small-latest";
  $("f-auto").checked = Boolean(c.traiterAuto);
  $("f-rappel").value = c.rappelMinutes != null ? c.rappelMinutes : 60;
  $("f-longueur").value = c.longueurMax != null ? c.longueurMax : 8000;
}

$("form-options").addEventListener("submit", async (e) => {
  e.preventDefault();
  await browser.storage.local.set({
    config: {
      apiKey: $("f-apikey").value.trim(),
      modele: $("f-modele").value,
      traiterAuto: $("f-auto").checked,
      rappelMinutes: Number($("f-rappel").value) || 0,
      longueurMax: Number($("f-longueur").value) || 8000
    }
  });
  $("statut").textContent = "Enregistré ✓";
});

$("btn-voir").addEventListener("click", () => {
  const i = $("f-apikey");
  i.type = i.type === "password" ? "text" : "password";
});

$("btn-tester").addEventListener("click", async () => {
  const cle = $("f-apikey").value.trim();
  if (!cle) {
    $("statut").textContent = "Saisissez d'abord une clé.";
    return;
  }
  $("statut").textContent = "Test en cours…";
  try {
    const r = await browser.runtime.sendMessage({ type: "testApiKey", apiKey: cle });
    $("statut").textContent = r.ok
      ? `Clé valide (HTTP ${r.statut}) ✓`
      : `Clé refusée par l'API (HTTP ${r.statut}) — vérifiez la clé et ses droits.`;
  } catch (e) {
    $("statut").textContent = "Erreur réseau : " + ((e && e.message) || e);
  }
});

charger();
