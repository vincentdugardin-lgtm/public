"use strict";

const PANEL_ID = "mailagent-panel";

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c != null) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function boutonAction(texte, onClick) {
  const b = el("button", { type: "button", class: "mailagent-bouton", text: texte });
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await onClick(b);
    } catch (e) {
      b.disabled = false;
      b.textContent = "Erreur : " + ((e && e.message) || e);
    }
  });
  return b;
}

function afficherResultats(message, resultats, conteneur) {
  for (const r of resultats) {
    const carte = el("div", { class: "mailagent-carte" });
    carte.appendChild(el("h3", { text: r.agent.nom }));
    if (r.erreur) {
      carte.appendChild(el("p", { class: "mailagent-erreur", text: "Erreur : " + r.erreur }));
      conteneur.appendChild(carte);
      continue;
    }
    const res = r.resultat;
    const actions = r.agent.actions || {};
    carte.appendChild(
      el("p", { class: "mailagent-ligne" },
        el("span", { class: `mailagent-priorite mailagent-p${res.priorite}`, text: `Priorité ${res.priorite}/5` }))
    );
    if (res.resume) {
      carte.appendChild(el("p", { class: "mailagent-resume", text: res.resume }));
    }
    if (actions.priorite) {
      carte.appendChild(boutonAction("Appliquer la priorité (étiquette + étoile)", async (b) => {
        await browser.runtime.sendMessage({
          type: "applyAction", action: "priorite", messageId: message.id,
          data: { priorite: res.priorite }
        });
        b.textContent = "✓ Priorité appliquée";
      }));
    }
    if (actions.reponse && res.reponse_suggeree) {
      carte.appendChild(el("div", { class: "mailagent-reponse" },
        el("strong", { text: "Réponse suggérée :" }),
        el("pre", { text: res.reponse_suggeree })));
      carte.appendChild(boutonAction("Créer un brouillon de réponse", async (b) => {
        await browser.runtime.sendMessage({
          type: "applyAction", action: "reponse", messageId: message.id,
          data: { reponse_suggeree: res.reponse_suggeree }
        });
        b.textContent = "✓ Brouillon ouvert";
      }));
    }
    if (actions.echeances && res.echeances.length > 0) {
      const liste = el("ul", { class: "mailagent-echeances" });
      for (const e of res.echeances) {
        liste.appendChild(el("li", { text: `${e.date}${e.heure ? " à " + e.heure : ""} — ${e.objet}` }));
      }
      carte.appendChild(el("div", {}, el("strong", { text: "Échéances détectées :" }), liste));
      carte.appendChild(boutonAction("Créer les rappels", async (b) => {
        await browser.runtime.sendMessage({
          type: "applyAction", action: "echeances", messageId: message.id,
          data: { echeances: res.echeances, agentNom: r.agent.nom }
        });
        b.textContent = "✓ Rappels créés";
      }));
    }
    conteneur.appendChild(carte);
  }
}

async function chargerEtAfficher(message, zone) {
  let agents = [];
  let config = {};
  try {
    agents = (await browser.runtime.sendMessage({ type: "getAgents" })) || [];
    config = (await browser.runtime.sendMessage({ type: "getConfigPublique" })) || {};
  } catch (e) {
    zone.appendChild(el("p", { class: "mailagent-erreur", text: "Module indisponible : " + ((e && e.message) || e) }));
    return;
  }
  if (!config.apiKeyPresente) {
    zone.appendChild(el("p", { class: "mailagent-erreur",
      text: "Aucune clé API Mistral configurée : ouvrez les options du module (bouton de la barre d'outils → Options) pour la renseigner." }));
    return;
  }
  const actifs = agents.filter((a) => a.actif);
  if (actifs.length === 0) {
    zone.appendChild(el("p", { text: "Aucun agent actif : créez-en un depuis le bouton « Assistant Mail » de la barre d'outils." }));
    return;
  }
  const cases = actifs.map((a) => {
    const c = el("input", { type: "checkbox", value: a.id, checked: "checked" });
    return el("label", { class: "mailagent-agent" }, c, el("span", { text: a.nom }));
  });
  const bouton = el("button", { type: "button", class: "mailagent-bouton mailagent-bouton-principal", text: "Analyser ce mail" });
  const statut = el("div", { class: "mailagent-statut" });
  const resultats = el("div", { class: "mailagent-resultats" });
  zone.append(el("div", { class: "mailagent-agents" }, ...cases), bouton, statut, resultats);
  bouton.addEventListener("click", async () => {
    bouton.disabled = true;
    statut.textContent = "Analyse en cours…";
    resultats.textContent = "";
    const ids = cases
      .map((l) => l.querySelector("input"))
      .filter((i) => i.checked)
      .map((i) => i.value);
    try {
      const r = await browser.runtime.sendMessage({
        type: "process", messageId: message.id, agentIds: ids, appliquer: false, auto: false
      });
      if (!r || !r.ok) {
        statut.textContent = "Erreur : " + (r && r.erreur ? r.erreur : "inconnue");
      } else {
        statut.textContent = `${r.resultats.length} agent(s) exécuté(s). Choisissez les actions à appliquer :`;
        afficherResultats(message, r.resultats, resultats);
      }
    } catch (e) {
      statut.textContent = "Erreur : " + ((e && e.message) || e);
    } finally {
      bouton.disabled = false;
    }
  });
}

function construirePanneau(message) {
  const panneau = el("div", { id: PANEL_ID, class: "mailagent" });
  const barre = el("div", { class: "mailagent-barre" },
    el("span", { class: "mailagent-titre", text: "Assistant Mail (Mistral)" }));
  const zone = el("div", { class: "mailagent-zone" });
  panneau.append(barre, zone);
  chargerEtAfficher(message, zone);
  return panneau;
}

browser.messageDisplay.onMessageDisplayed.addListener(async (message) => {
  try {
    await browser.runtime.sendMessage({ type: "registerDisplayed", messageId: message.id });
  } catch (e) {
    console.error(e);
  }
  const existant = document.getElementById(PANEL_ID);
  if (existant) existant.remove();
  document.body.insertBefore(construirePanneau(message), document.body.firstChild);
});
