# Serious Game — Facturation électronique

Plateforme web pour animer le jeu **« Le vrai match commence après le go-live »** :
Acte 1 *Comité de crise* et Acte 2 *Choose your transformation*.

La direction de jeu ouvre une session et projette un code. Chaque joueur rejoint
depuis son téléphone, reçoit un **rôle tiré au sort** et son briefing personnel,
puis vote A / B / C à chaque carte. La table décide **à la majorité** ; en cas
d’égalité, la **Direction générale tranche**. Les points restent **scellés**
jusqu’au dévoilement final, simultané pour toutes les tables. Aucune statistique
individuelle n’est calculée, ni affichée.

Tout est bilingue **FR / EN**, en thème sombre (identité du kit de cartes) ou
clair (identité papier), au choix de chaque écran.

---

## Trois consoles, trois accès

| Qui | Porte d’entrée | Ce qu’il voit |
| --- | -------------- | ------------- |
| **Direction de jeu** (super animateur) | *Direction de jeu* → crée la session | tout : tables, codes, scores en temps réel, classements, journal |
| **Animateur de table** | *Animer une table* → code de table (6 caractères) | sa table seulement : carte en cours, chrono, composition, avancement. Il n’a pas de rôle et ne vote pas |
| **Joueur** | *Rejoindre la partie* → code de session + prénom | son rôle et son briefing, la carte, son vote, sa table. Pas de points avant le dévoilement |

À la création, la session pré-crée les tables demandées (« Table 1 », « Table 2 »…),
chacune avec son propre code d’animateur. Les joueurs, eux, n’utilisent qu’un seul
code : celui de la session. Ils sont **répartis automatiquement** sur la table la
moins remplie.

---

## Démarrage

```bash
npm install
npm start
```

```
Direction de jeu : http://localhost:3000
Joueurs          : http://192.168.1.x:3000     (adresse affichée au démarrage)
```

Les joueurs utilisent l’adresse réseau (même Wi-Fi) ou le lien `/join/CODE`
affiché dans la console ; un animateur de table peut aussi ouvrir directement
`/table/CODE`.

Options d’environnement : `PORT` (3000), `HOST` (0.0.0.0), `DATA_DIR` (`./data`),
`ADMIN_PASSPHRASE` (vide = accès ouvert), `PUBLIC_URL` (déduit automatiquement sur
Render).

Vérifications automatiques — partie complète simulée côté serveur (rôles, votes,
arbitrage, scellé, dévoilement, archivage) + contrôle statique du front (parité
FR / EN, clés utilisées, identifiants DOM, classes CSS, intégrité des deux thèmes,
paramètres des messages du journal) :

```bash
npm run check      # = npm run lint:ui && npm run smoke
```

---

## Déroulé d’une partie

1. **Direction de jeu → « Ouvrir la session »** : nom de la session, nom de
   l’animateur, nombre de tables (1 à 12), joueurs par table (2 à 10). La console
   affiche le code de session, le lien joueurs et un code par table.
2. **Les joueurs rejoignent** : code de session + prénom, un téléphone par
   personne. Ils se répartissent seuls entre les tables.
3. **Distribution des rôles** : dès qu’une table est complète, les six rôles sont
   tirés au sort — exactement une **Direction générale** par table. Chaque joueur
   reçoit son objectif et sa phrase de personnage. Les arrivées tardives reçoivent
   un rôle d’appoint (jamais DG).
4. **Récit d’ouverture** : la crise est posée sur l’écran de chaque joueur avant
   la première carte.
5. **Chaque table avance à son rythme** : son animateur lance la carte suivante
   (5 min par défaut), peut ajouter du temps, mettre en pause, clore le vote plus
   tôt ou annuler l’événement. La direction de jeu peut aussi lancer une même
   carte sur plusieurs tables d’un coup.
6. **Vote** : chaque joueur choisit A, B ou C sur son téléphone. La console de
   table montre la progression (4 / 6 ont voté) sans révéler les choix.
7. **Décision** : majorité simple. En cas d’**égalité**, la table passe en
   arbitrage : la Direction générale tranche entre les options à égalité
   (90 s par défaut). Sans arbitrage dans le temps imparti, le sort décide.
   L’animateur de table peut suppléer le DG si nécessaire.
8. **Points scellés** : le résultat de la carte s’affiche (décision, répartition
   des voix), mais aucun point, aucun classement n’est visible des joueurs ni des
   animateurs de table.
9. **Dévoilement** : quand les tables ont terminé, la direction de jeu clique
   **« Dévoiler les scores à tous »**. Classement général, classement par
   événement, profils Acte 1 et Acte 2 apparaissent au même instant sur tous les
   écrans.
10. **Terminer et archiver** : la partie rejoint *Historique* avec le classement
    final, les compositions et rôles, le détail par événement, les ajustements et
    un export Excel (CSV).

---

## Les six rôles

Tirés au sort par table, avec pour chacun un objectif et une réplique de
personnage :

- **Direction générale / Communication** — arbitre les priorités et l’image de
  l’entreprise. **Tranche les égalités** au nom de la table.
- **Directeur fiscal** — position TVA, réponse à l’administration, sort de la CA3.
- **DAF / Trésorerie** — trésorerie et BFR malgré les paiements bloqués.
- **DSI / Chef de projet e-invoicing** — cause technique et pilotage de la plateforme.
- **Direction juridique** — relation avec l’administration, qualification de l’erreur.
- **Relation clients** — relation commerciale et cadrage de la communication.

---

## Barème

Repris du kit de cartes.

**Acte 1 — Comité de crise** (deux axes, cumulés carte après carte)

| Choix | Court terme | Long terme | Total événement |
| ----- | ----------- | ---------- | --------------- |
| A — quick fix | +2 | −3 | −1 |
| B — intermédiaire | +1 | +1 | +2 |
| C — structurant | −2 | +3 | +1 |

Profils Acte 1 : `< 0` Firefighter · `0–5` Conforme fragile · `5–10` En contrôle ·
`> 10` Data driven leader.

**Acte 2 — Choose your transformation**

| Choix | Points |
| ----- | ------ |
| A — court terme | 0 |
| B — équilibré | +2 |
| C — structurant | +4 |

Profils Acte 2 : `0–4` Survivor · `5–8` Compliant · `9–12` Controller ·
`13–16` Data Leader.

Le **total** d’une table = Acte 1 + Acte 2 + ajustements manuels. Le classement
général trie par total, puis par nombre de victoires d’événement. Le **classement
par événement** compare les tables carte par carte (points, puis rapidité de la
décision) ; la table gagnante porte une étoile.

---

## Ce que contrôle la direction de jeu

- **Tables** : en ajouter, consulter la vue d’ensemble de chacune, redistribuer
  les rôles, copier son code d’animateur.
- **Déroulé** : lancer une carte sur plusieurs tables, réordonner, modifier ou
  supprimer les cartes, en créer de nouvelles (bilingues, avec leur propre
  barème), rejouer un événement.
- **Points** : ajouter ou retirer des points à une table avec un motif tracé,
  supprimer un ajustement.
- **Décisions** : corriger le choix retenu par une table sur n’importe quel
  événement, même après coup — scores, classements et historique se recalculent.
- **Dévoilement** : le moment du grand écran, sous confirmation.
- **Réglages** : durée du vote, temps d’arbitrage du DG, joueurs par table
  (déclenche la distribution des rôles), distribution automatique des rôles,
  clôture dès que tout le monde a voté, changement de vote autorisé, arrivées en
  cours de partie.
- **Journal de la session** : chaque lancement, décision, égalité, arbitrage,
  pause et dévoilement, horodaté.

Ce qu’elle ne contrôle pas : rien de nominatif. Aucun score, aucun classement
individuel n’existe dans le modèle de données.

---

## Contenu livré

- 6 cartes **Acte 1** : factures rejetées, blocage de paiement, DGFIP —
  incohérences, alerte sur les contrôles, article de presse, tension cash.
- 4 étapes **Acte 2** : stabilisation, risque fiscal, data vs IT, vision.
- Le récit d’ouverture de la crise et les 6 rôles avec leurs briefings.
- Profils de fin de partie, classements et export CSV.

---

## Déploiement sur Render

Le dépôt contient un blueprint prêt à l’emploi (`render.yaml`).

**Option 1 — Blueprint.** Render → *New* → *Blueprint* → pointer sur le dépôt.
Render lit `render.yaml`, crée le service web et le disque, et demande la valeur
de `ADMIN_PASSPHRASE`.

**Option 2 — Service web à la main.** Render → *New* → *Web Service* :

| Réglage | Valeur |
| ------- | ------ |
| Runtime | Node |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Instances | **1** (obligatoire) |

Variables d’environnement :

| Variable | Rôle |
| -------- | ---- |
| `ADMIN_PASSPHRASE` | Protège la création de session et l’historique. À définir dès que le site est public. |
| `DATA_DIR` | `/var/data` si un disque persistant est monté. Sinon laisser vide. |
| `PORT` | Fourni par Render, ne pas y toucher. |
| `PUBLIC_URL` | Optionnel : Render fournit déjà `RENDER_EXTERNAL_URL`. |

Trois points à connaître :

1. **Une seule instance.** L’état de la partie vit en mémoire et les clients sont
   connectés en WebSocket ; Render ne fait pas de *sticky sessions*, donc deux
   instances couperaient les tables de leur session. Ne pas activer l’autoscaling.
2. **Persistance.** Sans disque persistant, le système de fichiers est effacé à
   chaque déploiement ou redémarrage : les parties archivées disparaissent.
   Monter un disque (plan payant) sur `/var/data` et poser `DATA_DIR=/var/data`.
   Une partie en cours reste de toute façon en mémoire, donc un redéploiement en
   plein jeu est à éviter. Si le dossier n’est pas accessible en écriture, le
   serveur continue en mémoire au lieu de refuser de démarrer (`/api/health`
   renvoie alors `persistent: false`).
3. **Plan gratuit.** Le service s’endort après ~15 min sans trafic et le premier
   accès met quelques secondes ; pas de disque possible. Utilisable pour tester,
   pas pour un atelier avec un vrai public.

**Phrase d’accès.** Quand `ADMIN_PASSPHRASE` est défini, la direction de jeu la
saisit une fois (elle est demandée à la création de session et à l’ouverture de
l’historique, puis mémorisée dans son navigateur). Ni les animateurs de table ni
les joueurs n’en ont besoin : leur code à 6 caractères suffit. Sans cette
variable, tout est ouvert — ce qui convient à un réseau local, pas à une URL
publique.

Une fois déployé, l’adresse à projeter est simplement l’URL Render du service ;
le lien joueurs affiché dans la console suit automatiquement (`https://…/join/CODE`).

---

## Architecture

```
server/
  index.js   API HTTP + Socket.IO, minuteurs par table, export CSV
  game.js    moteur : sessions, tables, rôles, votes, arbitrage, barème,
             classements, scellé/dévoilement, archivage
  deck.js    contenu du jeu (récit, cartes, rôles, profils) en FR / EN
  store.js   persistance JSON atomique (data/sessions.json, data/records.json)
public/
  index.html    trois portes : joueur, animateur de table, direction de jeu
  admin.html    console de la direction de jeu
  team.html     console d’un animateur de table
  play.html     poste d’un joueur
  records.html  historique et exports
  css/app.css   deux thèmes complets (sombre « kit de cartes », clair « papier »)
  js/i18n.js    dictionnaire FR / EN
  js/common.js  DOM, stockage local, socket, toasts, thème
  js/cards.js   cartes, rôles, chrono, répartition des voix, classements
scripts/
  smoke.js    partie complète de bout en bout (serveur + sockets, 38 vérifications)
  lint-ui.js  contrôles statiques du front (traductions, ids, classes, thèmes)
```

Aucune étape de build, aucune base de données : Node + Express + Socket.IO et des
fichiers JSON. Les sessions survivent à un redémarrage du serveur (les chronos en
cours sont réarmés, un vote expiré est clos au démarrage).

**Ce que reçoit chaque écran.** Le serveur ne diffuse pas un état global : il
projette l’état selon l’audience (`super`, animateur de table, joueur). Un joueur
ne reçoit ni les scores, ni les codes des autres tables, ni les votes nominatifs
des autres ; les clés de points sont absentes du message tant que le dévoilement
n’a pas eu lieu. Rien à cacher côté navigateur, donc rien à trouver dans la
console.

**Accès.** Chaque session a une clé de direction de jeu, chaque table un jeton
d’animateur et un code, chaque joueur un jeton. Ils sont mémorisés dans le
navigateur, ce qui permet de reprendre après un rafraîchissement. Pour ouvrir la
console de direction sur un autre appareil : `/admin.html?s=<sessionId>&k=<clé>`
(la clé est retirée de l’URL une fois mémorisée). L’outil est conçu pour un usage
en salle sur réseau de confiance.
