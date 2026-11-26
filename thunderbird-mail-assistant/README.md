# Assistant Mail Mistral — add-on Thunderbird

Add-on MailExtension pour Thunderbird 115+ qui fait traiter vos mails par des **agents IA** (API Mistral) :

- **Priorité** : chaque mail analysé reçoit un score de 1 à 5, appliqué sous forme d'étiquette Thunderbird (`$label1` Important, `$label4` À faire) et d'étoile pour les urgences.
- **Réponses suggérées** : un brouillon de réponse est proposé (jamais envoyé automatiquement).
- **Échéances** : les dates butoir détectées dans les mails créent des **rappels** (alarme + notification) à l'heure voulue.

## Prérequis

- Thunderbird 115 ou supérieur.
- Une clé API Mistral ([console.mistral.ai](https://console.mistral.ai/api-keys/)).

## Installation (développement)

1. Ouvrez `about:debugging` dans Thunderbird.
2. « Charger un module complémentaire temporaire » → sélectionnez le fichier `manifest.json` de ce dossier.
3. À la première installation, la page d'options s'ouvre : collez votre clé API Mistral, testez-la, enregistrez.

## Installation permanente (`.xpi`)

```bash
cd thunderbird-mail-assistant
zip -r ../assistant-mail-mistral.xpi . -x '.*' -x 'README.md'
```

Puis dans Thunderbird : menu ≡ → Modules complémentaires → ⚙ → « Installer un module depuis un fichier » → sélectionnez le `.xpi`. (Pour une diffusion publique, soumettez le `.xpi` sur [addons.thunderbird.net](https://addons.thunderbird.net) pour signature.)

## Utilisation

- **Bouton « Assistant Mail »** (barre d'outils) : ouvre la fenêtre de dialogue des agents — créer, modifier, activer/désactiver, supprimer, exporter/importer (JSON), et consulter les échéances enregistrées.
- **Panneau dans la lecture d'un mail** : choisissez les agents à lancer puis « Analyser ce mail » ; appliquez ensuite au choix la priorité, le brouillon de réponse, les rappels.
- **Raccourci `Ctrl+Shift+A`** : traite le mail affiché avec tous les agents actifs (priorité + échéances appliquées directement, résumé en notification).
- **Mode automatique** (optionnel, dans les options) : chaque nouveau mail reçu est traité automatiquement.

## Fonctionnement

Pour chaque agent actif, l'add-on :

1. lit le mail (`messages.getFull`, partie `text/plain`, tronquée à la longueur configurée) ;
2. appelle `POST https://api.mistral.ai/v1/chat/completions` avec le prompt de l'agent et exige une **réponse JSON** :

```json
{
  "priorite": 5,
  "resume": "...",
  "reponse_suggeree": "...",
  "echeances": [{ "date": "2025-06-30", "heure": "14:00", "objet": "Envoyer le rapport" }]
}
```

3. applique les actions cochées pour l'agent : étiquette/étoile (`messages.update`), brouillon (`compose.beginReply`), rappels (`alarms.create` + `notifications` à l'échéance, moins le délai configuré).

## Structure

```
manifest.json        déclaration, permissions, commandes, scripts
background.js        cœur : agents, appels API Mistral, actions, alarmes, notifications
messagedisplay.js    panneau d'analyse dans la vue de lecture d'un mail
messagedisplay.css   styles du panneau
agents.html/js/css   fenêtre de dialogue : CRUD des agents, échéances, import/export
options.html/js      clé API, modèle par défaut, mode auto, délais
icons/               icônes PNG (16/32/48/128)
```

## Données et sécurité

- La clé API et les agents sont stockés dans `storage.local` (profil Thunderbird local). Aucune donnée n'est envoyée ailleurs qu'à `https://api.mistral.ai`.
- Le contenu des mails est envoyé à l'API Mistral uniquement lorsqu'un agent analyse ce mail (manuellement, par raccourci, ou en mode auto si activé). Réglez « longueur maximale » dans les options pour limiter la quantité envoyée.
- Aucun mail n'est jamais envoyé automatiquement : les réponses suggérées s'ouvrent comme brouillon à valider.

## Limites connues

- L'analyse porte sur la partie `text/plain` du mail (les pièces jointes PDF/images ne sont pas lues).
- Le mode automatique ne crée pas de brouillon de réponse (trop intrusif) : priorité et échéances seulement.
