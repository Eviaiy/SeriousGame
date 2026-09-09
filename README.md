# Serious Game — Facturation électronique

Plateforme web pour animer le jeu **« Le vrai match commence après le go-live »** :
Acte 1 *Comité de crise* et Acte 2 *Choose your transformation*.

L’animateur crée une session et projette un code. Chaque table rejoint sur son
téléphone, vote A / B / C sous chronomètre, et l’écran de l’animateur annonce le
gagnant de l’événement puis le classement général. Tout est bilingue **FR / EN**
(bouton en haut à droite de chaque écran).

---

## Démarrage

```bash
npm install
npm start
```

```
Animateur / Admin : http://localhost:3000
Joueurs / Players : http://192.168.1.x:3000     (adresse affichée au démarrage)
```

L’animateur ouvre `http://localhost:3000`, les joueurs utilisent l’adresse
réseau (même Wi-Fi) ou scannent le lien `/join/CODE`.

Options d’environnement : `PORT` (3000), `HOST` (0.0.0.0), `DATA_DIR` (`./data`),
`ADMIN_PASSPHRASE` (vide = accès ouvert), `PUBLIC_URL` (déduit automatiquement sur
Render).

Vérifications automatiques (session complète simulée côté serveur + contrôle du
front : parité FR/EN, clés de traduction, identifiants DOM, fichiers référencés) :

```bash
npm run check      # = npm run lint:ui && npm run smoke
```

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
   instances couperaient les équipes de leur session. Ne pas activer l’autoscaling.
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

**Phrase d’accès.** Quand `ADMIN_PASSPHRASE` est défini, l’animateur la saisit une
fois (elle est demandée à la création de session et à l’ouverture de l’historique,
puis mémorisée dans son navigateur). Les équipes n’en ont pas besoin : le code de
session à 6 caractères leur suffit. Sans cette variable, tout est ouvert — ce qui
convient à un réseau local, pas à une URL publique.

Une fois déployé, l’adresse à projeter est simplement l’URL Render du service ;
le lien joueurs affiché dans la console suit automatiquement (`https://…/join/CODE`).

---

## Déroulé d’une partie

1. **Accueil → « Animer une session »** : nom de la session, animateur. La
   console s’ouvre avec un code à 6 caractères et le lien joueurs.
2. **Les équipes rejoignent** : code + nom d’équipe, un appareil par table.
   L’animateur peut aussi créer une équipe à la main (saisie papier).
3. **Lancer un événement** : dans *Déroulé des événements*, choisir la durée puis
   `Lancer`. La carte s’affiche simultanément sur tous les écrans.
4. **Vote** : chaque équipe choisit A, B ou C. La console montre en direct qui a
   répondu (sans révéler les choix aux autres tables).
5. **Fin du chrono** : clôture automatique, calcul des points, annonce du
   **gagnant de l’événement** (meilleur score, à égalité la réponse la plus
   rapide). L’animateur peut aussi clore avant la fin, mettre en pause, ou
   ajouter / retirer 30 s.
6. **Valider et passer au suivant** : l’événement rejoint l’historique.
7. **Terminer et archiver** : la partie est enregistrée dans *Historique* avec
   classement final, détail par événement, ajustements, et export Excel (CSV).

---

## Barème

Repris du kit de cartes.

**Acte 1 — Comité de crise** (deux axes, cumulés round après round)

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

Le **total général** d’une équipe = Acte 1 + Acte 2 + ajustements manuels.
Le classement trie par total, puis par nombre de victoires d’événement.

---

## Ce que l’animateur contrôle

- **Chrono** : durée par événement, pause / reprise, ±30 s, clôture immédiate.
- **Points** : ajouter ou retirer des points à une équipe avec un motif tracé
  (boutons rapides −5 … +5 ou valeur libre), suppression d’un ajustement.
- **Réponses** : corriger le choix d’une équipe sur n’importe quel événement,
  même après coup — les scores et l’historique se recalculent.
- **Équipes** : ajouter, renommer, retirer.
- **Déroulé** : réordonner, modifier ou supprimer les cartes, en créer de
  nouvelles (bilingues, avec leur propre barème), rejouer un événement.
- **Réglages** : durée par défaut, révélation automatique, clôture dès que tout
  le monde a répondu, changement de réponse autorisé, inscriptions tardives,
  affichage du classement aux équipes (à masquer pour garder le suspense de
  l’Acte 2), pénalité en cas de non-réponse.

---

## Contenu livré

- 6 cartes **Acte 1** : factures rejetées, blocage de paiement, DGFIP —
  incohérences, alerte sur les contrôles, article de presse, tension cash.
- 4 étapes **Acte 2** : stabilisation, risque fiscal, data vs IT, vision.
- Les 6 **rôles** du comité de crise, consultables par les équipes et l’animateur.
- Profils de fin de partie et révélations après vote.

---

## Architecture

```
server/
  index.js   API HTTP + Socket.IO, minuteurs de round, export CSV
  game.js    moteur : sessions, équipes, rounds, barème, gagnants, archivage
  deck.js    contenu du jeu (cartes, rôles, profils) en FR / EN
  store.js   persistance JSON atomique (data/sessions.json, data/records.json)
public/
  index.html / admin.html / play.html / records.html
  js/i18n.js   dictionnaire FR / EN
  js/common.js DOM, stockage local, socket, toasts
  js/cards.js  rendu des cartes, chrono, classements
  js/admin.js  console animateur
  js/play.js   espace équipe
  js/records.js historique et exports
scripts/
  smoke.js    test de bout en bout (serveur + sockets, 27 vérifications)
  lint-ui.js  contrôles statiques du front (traductions, ids, assets)
```

Aucune étape de build, aucune base de données : Node + Express + Socket.IO et
des fichiers JSON. Les sessions survivent à un redémarrage du serveur (les
chronos en cours sont réarmés, un round expiré est clos au démarrage).

Sécurité : chaque session a une clé animateur, chaque équipe un jeton. Ils sont
mémorisés dans le navigateur, ce qui permet de reprendre la partie après un
rafraîchissement. Pour ouvrir la console sur un autre appareil, utiliser
`/admin.html?s=<sessionId>&k=<adminKey>` (la clé est retirée de l’URL une fois
mémorisée). L’outil est conçu pour un usage en salle sur réseau de confiance.
