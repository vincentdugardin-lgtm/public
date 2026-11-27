"use strict";

const $ = (id) => document.getElementById(id);
let agents = [];
let editionId = null;

async function chargerAgents() {
  agents = (await browser.storage.local.get("agents")).agents || [];
  afficherAgents();
}

async function sauvegarder() {
  await browser.storage.local.set({ agents });
}

function afficherAgents() {
  const ul = $("liste-agents");
  ul.textContent = "";
  if (agents.length === 0) {
    const li = document.createElement("li");
    li.className = "vide";
    li.textContent = "Aucun agent. Cliquez sur « + Nouvel agent ».";
    ul.appendChild(li);
    return;
  }
  for (const a of agents) {
    const li = document.createElement("li");
    li.className = "agent" + (a.actif ? "" : " inactif");
    const act = a.actions || {};
    const libelles = [];
    if (act.priorite) libelles.push("priorité");
    if (act.reponse) libelles.push("réponse");
    if (act.echeances) libelles.push("échéances");

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = Boolean(a.actif);
    toggle.title = "Agent actif";
    toggle.addEventListener("change", async () => {
      a.actif = toggle.checked;
      await sauvegarder();
      afficherAgents();
    });

    const nom = document.createElement("strong");
    nom.textContent = a.nom;

    const badges = document.createElement("span");
    badges.className = "badges";
    badges.textContent = libelles.join(" · ") || "aucune action";

    const modele = document.createElement("span");
    modele.className = "modele";
    modele.textContent = a.modele || "";

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.textContent = "Éditer";
    btnEdit.addEventListener("click", () => ouvrirFormulaire(a));

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.textContent = "Supprimer";
    btnDel.addEventListener("click", async () => {
      if (!confirm(`Supprimer l'agent « ${a.nom} » ?`)) return;
      agents = agents.filter((x) => x.id !== a.id);
      await sauvegarder();
      afficherAgents();
    });

    li.append(toggle, nom, badges, modele, btnEdit, btnDel);
    ul.appendChild(li);
  }
}

function ouvrirFormulaire(a) {
  editionId = a ? a.id : null;
  $("form-titre").textContent = a ? `Modifier « ${a.nom} »` : "Nouvel agent";
  $("f-nom").value = a ? a.nom : "";
  $("f-modele").value = a ? a.modele || "mistral-small-latest" : "mistral-small-latest";
  $("f-prompt").value = a ? a.prompt : "";
  $("f-priorite").checked = a ? Boolean(a.actions && a.actions.priorite) : true;
  $("f-reponse").checked = a ? Boolean(a.actions && a.actions.reponse) : false;
  $("f-echeances").checked = a ? Boolean(a.actions && a.actions.echeances) : true;
  $("f-actif").checked = a ? Boolean(a.actif) : true;
  $("formulaire").hidden = false;
  $("f-nom").focus();
}

$("btn-nouveau").addEventListener("click", () => ouvrirFormulaire(null));
$("btn-annuler").addEventListener("click", () => {
  $("formulaire").hidden = true;
  editionId = null;
});

$("form-agent").addEventListener("submit", async (e) => {
  e.preventDefault();
  const agent = {
    id: editionId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nom: $("f-nom").value.trim(),
    modele: $("f-modele").value,
    prompt: $("f-prompt").value.trim(),
    actions: {
      priorite: $("f-priorite").checked,
      reponse: $("f-reponse").checked,
      echeances: $("f-echeances").checked
    },
    actif: $("f-actif").checked,
    creeLe: new Date().toISOString()
  };
  if (!agent.nom || !agent.prompt) return;
  const i = agents.findIndex((x) => x.id === agent.id);
  if (i >= 0) agents[i] = agent;
  else agents.push(agent);
  await sauvegarder();
  $("formulaire").hidden = true;
  editionId = null;
  afficherAgents();
});

async function chargerEcheances() {
  const liste = (await browser.runtime.sendMessage({ type: "getEcheances" })) || [];
  const ul = $("liste-echeances");
  ul.textContent = "";
  if (liste.length === 0) {
    const li = document.createElement("li");
    li.className = "vide";
    li.textContent = "Aucune échéance enregistrée.";
    ul.appendChild(li);
    return;
  }
  liste.sort((a, b) => (a.date + (a.heure || "")).localeCompare(b.date + (b.heure || "")));
  for (const e of liste) {
    const li = document.createElement("li");
    const txt = document.createElement("span");
    txt.textContent = `${e.date}${e.heure ? " à " + e.heure : ""} — ${e.objet} (mail : ${e.sujetMail || "?"}, agent : ${e.agent || "?"})`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Supprimer";
    btn.addEventListener("click", async () => {
      await browser.runtime.sendMessage({ type: "deleteEcheance", id: e.id });
      chargerEcheances();
    });
    li.append(txt, btn);
    ul.appendChild(li);
  }
}

$("btn-exporter").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(agents, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "agents-assistant-mail.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("fichier-import").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data)) throw new Error("le fichier doit contenir un tableau JSON");
    agents = data.map((a) => ({
      id: a.id || `agent-${Math.random().toString(36).slice(2, 10)}`,
      nom: String(a.nom || "Agent sans nom"),
      modele: a.modele || "mistral-small-latest",
      prompt: String(a.prompt || ""),
      actions: Object.assign({ priorite: true, reponse: false, echeances: true }, a.actions || {}),
      actif: a.actif !== false,
      creeLe: a.creeLe || new Date().toISOString()
    }));
    await sauvegarder();
    afficherAgents();
  } catch (err) {
    alert("Import impossible : " + ((err && err.message) || err));
  }
  e.target.value = "";
});

$("btn-options").addEventListener("click", () => browser.runtime.openOptionsPage());

chargerAgents();
chargerEcheances();
