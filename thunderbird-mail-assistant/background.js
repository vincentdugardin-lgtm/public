"use strict";

const API_BASE = "https://api.mistral.ai/v1";
const ETIQUETTES_PAR_PRIORITE = { 5: "$label1", 4: "$label1", 3: "$label4" };
const displayedByTab = new Map();

const CONFIG_PAR_DEFAUT = {
  apiKey: "",
  modele: "mistral-small-latest",
  traiterAuto: false,
  rappelMinutes: 60,
  longueurMax: 8000
};

async function getConfig() {
  const d = await browser.storage.local.get("config");
  return Object.assign({}, CONFIG_PAR_DEFAUT, d.config || {});
}

async function getAgents() {
  const d = await browser.storage.local.get("agents");
  return Array.isArray(d.agents) ? d.agents : [];
}

async function getEcheances() {
  const d = await browser.storage.local.get("echeances");
  return Array.isArray(d.echeances) ? d.echeances : [];
}

function extraireTexte(full) {
  const textes = [];
  (function parcourir(part) {
    if (!part) return;
    if (part.contentType === "text/plain" && typeof part.body === "string") {
      textes.push(part.body);
    }
    if (Array.isArray(part.parts)) part.parts.forEach(parcourir);
  })(full);
  if (textes.length === 0 && typeof full.body === "string") textes.push(full.body);
  return textes.join("\n\n");
}

function analyserJSON(brut) {
  let txt = String(brut || "").trim();
  const m = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) txt = m[1].trim();
  try {
    return JSON.parse(txt);
  } catch (e) {
    const i = txt.indexOf("{");
    const j = txt.lastIndexOf("}");
    if (i >= 0 && j > i) return JSON.parse(txt.slice(i, j + 1));
    throw new Error("La réponse de l'API n'est pas un JSON exploitable.");
  }
}

function normaliserResultat(brut) {
  const r = brut && typeof brut === "object" ? brut : {};
  let p = parseInt(r.priorite, 10);
  if (isNaN(p)) p = 3;
  p = Math.max(1, Math.min(5, p));
  const echeances = Array.isArray(r.echeances)
    ? r.echeances
        .filter((e) => e && /^\d{4}-\d{2}-\d{2}/.test(String(e.date || "")))
        .map((e) => ({
          date: String(e.date).slice(0, 10),
          heure: /^([01]\d|2[0-3]):[0-5]\d/.test(String(e.heure || "")) ? String(e.heure).slice(0, 5) : "",
          objet: String(e.objet || "Échéance").slice(0, 300)
        }))
    : [];
  return {
    priorite: p,
    resume: String(r.resume || "").slice(0, 1000),
    reponse_suggeree: String(r.reponse_suggeree || "").slice(0, 8000),
    echeances
  };
}

async function appelerMistral(agent, config, enTete, texte) {
  if (!config.apiKey) {
    throw new Error("Clé API Mistral manquante : renseignez-la dans les options du module.");
  }
  const systeme =
    String(agent.prompt || "Analyse le mail et réponds en JSON.") +
    "\nRéponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, aucune balise markdown) de cette forme :\n" +
    '{\n  "priorite": <entier de 1 à 5, 5 = urgent>,\n  "resume": "<résumé en 2-3 phrases>",\n' +
    '  "reponse_suggeree": "<brouillon de réponse, professionnel, vide si aucune réponse n\'est attendue>",\n' +
    '  "echeances": [ { "date": "AAAA-MM-JJ", "heure": "HH:MM" (optionnel), "objet": "<description courte>" } ]\n}';
  const utilisateur =
    `Expéditeur : ${enTete.author || ""}\nObjet : ${enTete.subject || ""}\nDate : ${enTete.date || ""}\n\n` +
    texte.slice(0, config.longueurMax);
  const resp = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: agent.modele || config.modele,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systeme },
        { role: "user", content: utilisateur }
      ]
    })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`API Mistral : HTTP ${resp.status} ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  const brut = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  return analyserJSON(brut);
}

async function appliquerPriorite(messageId, priorite) {
  const msg = await browser.messages.get(messageId);
  const tags = new Set(msg.tags || []);
  const p = Math.max(1, Math.min(5, parseInt(priorite, 10) || 3));
  const etiquette = ETIQUETTES_PAR_PRIORITE[p];
  if (etiquette) tags.add(etiquette);
  await browser.messages.update(messageId, {
    tags: Array.from(tags),
    flagged: p >= 5 ? true : Boolean(msg.flagged)
  });
}

async function enregistrerEcheances(messageId, sujetMail, agentNom, echeances, config) {
  const liste = await getEcheances();
  for (const ech of echeances) {
    const heure = ech.heure || "09:00";
    const quand = Date.parse(`${ech.date}T${heure}:00`);
    if (isNaN(quand)) continue;
    const id = `ech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    liste.push({
      id,
      messageId,
      objet: ech.objet,
      date: ech.date,
      heure,
      agent: agentNom,
      sujetMail: sujetMail || "",
      dateAjout: new Date().toISOString()
    });
    await browser.storage.local.set({ echeances: liste });
    const rappel = Math.max(quand - (config.rappelMinutes || 0) * 60000, Date.now() + 60000);
    await browser.alarms.create(id, { when: rappel });
  }
}

async function appliquerActions(messageId, header, agent, res, config, auto) {
  const actions = agent.actions || {};
  if (actions.priorite) {
    await appliquerPriorite(messageId, res.priorite);
  }
  if (!auto && actions.reponse && res.reponse_suggeree) {
    await browser.compose.beginReply(messageId, { body: res.reponse_suggeree });
  }
  if (actions.echeances && res.echeances.length > 0) {
    await enregistrerEcheances(messageId, header.subject || "", agent.nom, res.echeances, config);
  }
}

async function traiterMessage(messageId, agentIds, appliquer, auto) {
  const config = await getConfig();
  const tous = await getAgents();
  const selectionnes = tous.filter(
    (a) => a.actif && (!agentIds || agentIds.length === 0 || agentIds.includes(a.id))
  );
  if (selectionnes.length === 0) {
    return { ok: false, erreur: "Aucun agent actif sélectionné." };
  }
  const header = await browser.messages.get(messageId);
  const full = await browser.messages.getFull(messageId);
  const texte = extraireTexte(full);
  const resultats = [];
  for (const agent of selectionnes) {
    const infos = { id: agent.id, nom: agent.nom, actions: agent.actions || {} };
    try {
      const brut = await appelerMistral(agent, config, header, texte);
      const res = normaliserResultat(brut);
      if (appliquer) {
        await appliquerActions(messageId, header, agent, res, config, auto);
      }
      resultats.push({ agent: infos, resultat: res, erreur: null });
    } catch (e) {
      resultats.push({ agent: infos, resultat: null, erreur: String((e && e.message) || e) });
    }
  }
  return { ok: true, resultats };
}

async function appliquerActionUnitaire(msg) {
  const config = await getConfig();
  if (msg.action === "priorite") {
    await appliquerPriorite(msg.messageId, msg.data.priorite);
    return { ok: true };
  }
  if (msg.action === "reponse") {
    await browser.compose.beginReply(msg.messageId, { body: String(msg.data.reponse_suggeree || "") });
    return { ok: true };
  }
  if (msg.action === "echeances") {
    const header = await browser.messages.get(msg.messageId).catch(() => ({ subject: "" }));
    await enregistrerEcheances(
      msg.messageId,
      header.subject || "",
      msg.data.agentNom || "Agent",
      msg.data.echeances || [],
      config
    );
    return { ok: true };
  }
  return { ok: false, erreur: "Action inconnue." };
}

async function supprimerEcheance(id) {
  const liste = await getEcheances();
  await browser.storage.local.set({ echeances: liste.filter((e) => e.id !== id) });
  await browser.alarms.clear(id);
  return { ok: true };
}

async function testerCle(apiKey) {
  const resp = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: "Bearer " + apiKey }
  });
  return { ok: resp.ok, statut: resp.status };
}

async function notifier(titre, message) {
  await browser.notifications.create(`mailagent-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon-48.png",
    title: titre,
    message: String(message).slice(0, 300)
  });
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== "object") return undefined;
  switch (msg.type) {
    case "getAgents":
      return getAgents();
    case "getConfigPublique":
      return getConfig().then((c) => ({
        modele: c.modele,
        traiterAuto: c.traiterAuto,
        rappelMinutes: c.rappelMinutes,
        apiKeyPresente: Boolean(c.apiKey)
      }));
    case "process":
      return traiterMessage(msg.messageId, msg.agentIds || [], Boolean(msg.appliquer), Boolean(msg.auto));
    case "applyAction":
      return appliquerActionUnitaire(msg);
    case "getEcheances":
      return getEcheances();
    case "deleteEcheance":
      return supprimerEcheance(msg.id);
    case "testApiKey":
      return testerCle(String(msg.apiKey || ""));
    case "registerDisplayed":
      if (sender && sender.tab && sender.tab.id != null) {
        displayedByTab.set(sender.tab.id, msg.messageId);
      }
      return Promise.resolve(true);
    default:
      return undefined;
  }
});

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const d = await browser.storage.local.get("agents");
    if (!Array.isArray(d.agents) || d.agents.length === 0) {
      await browser.storage.local.set({
        agents: [
          {
            id: "agent-exemple",
            nom: "Tri pro & échéances",
            modele: "mistral-small-latest",
            prompt:
              "Tu es l'assistant personnel d'une boîte mail professionnelle. " +
              "Analyse le mail reçu : 1) évalue sa priorité de 1 à 5 (5 = urgent/stratégique, 1 = bruit/newsletter), " +
              "2) résume-le en 2 phrases maximum, 3) rédige une réponse suggérée courte et professionnelle " +
              "si une réponse est attendue (sinon laisse vide), 4) extrais toutes les échéances, dates butoir ou rendez-vous mentionnés.",
            actions: { priorite: true, reponse: true, echeances: true },
            actif: true,
            creeLe: new Date().toISOString()
          }
        ]
      });
    }
    browser.runtime.openOptionsPage();
  }
});

browser.browserAction.onClicked.addListener(() => {
  browser.windows.create({
    type: "popup",
    url: browser.runtime.getURL("agents.html"),
    width: 680,
    height: 760
  });
});

browser.commands.onCommand.addListener(async (command) => {
  if (command !== "traiter-mail") return;
  const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  const messageId = tab ? displayedByTab.get(tab.id) : undefined;
  if (!messageId) {
    await notifier("Assistant Mail", "Ouvrez d'abord le mail à traiter dans un onglet.");
    return;
  }
  const r = await traiterMessage(messageId, [], true, true);
  if (!r.ok) {
    await notifier("Assistant Mail", r.erreur);
    return;
  }
  const top = r.resultats
    .filter((x) => x.resultat)
    .sort((a, b) => b.resultat.priorite - a.resultat.priorite)[0];
  await notifier(
    top ? `Priorité ${top.resultat.priorite}/5 — ${top.agent.nom}` : "Traitement terminé",
    top ? top.resultat.resume : "Aucun résultat exploitable."
  );
});

browser.messages.onNewMailReceived.addListener(async (folder, messages) => {
  const config = await getConfig();
  if (!config.traiterAuto || !config.apiKey) return;
  for (const m of messages.list || []) {
    try {
      const r = await traiterMessage(m.id, [], true, true);
      const top = r.resultats
        .filter((x) => x.resultat)
        .sort((a, b) => b.resultat.priorite - a.resultat.priorite)[0];
      if (top) {
        await notifier(
          `Nouveau mail — priorité ${top.resultat.priorite}/5 (${top.agent.nom})`,
          `${m.subject || ""}\n${top.resultat.resume}`
        );
      }
    } catch (e) {
      console.error("Traitement auto du mail", m.id, e);
    }
  }
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("ech-")) return;
  const liste = await getEcheances();
  const ech = liste.find((e) => e.id === alarm.name);
  if (!ech) return;
  await browser.notifications.create(alarm.name, {
    type: "basic",
    iconUrl: "icons/icon-48.png",
    title: `Échéance : ${ech.objet}`,
    message: `Mail « ${ech.sujetMail || "?"} » (agent : ${ech.agent}) — le ${ech.date} à ${ech.heure}`
  });
});

browser.notifications.onClicked.addListener(() => {
  browser.windows.create({
    type: "popup",
    url: browser.runtime.getURL("agents.html"),
    width: 680,
    height: 760
  });
});
