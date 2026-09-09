/* Dictionnaire FR / EN + utilitaires de traduction. */
(function () {
  'use strict';

  const DICT = {
    fr: {
      'app.name': 'Serious Game',
      'app.title': 'Facturation électronique',
      'app.tagline': 'Le vrai match commence après le go-live',
      'app.acts': 'Acte 1 · Comité de crise — Acte 2 · Choose your transformation',

      'nav.home': 'Accueil',
      'nav.admin': 'Console animateur',
      'nav.play': 'Espace équipe',
      'nav.records': 'Historique',
      'nav.print': 'Imprimer',

      'btn.create': 'Créer la session',
      'btn.join': 'Rejoindre',
      'btn.copy': 'Copier',
      'btn.copied': 'Copié',
      'btn.close': 'Fermer',
      'btn.cancel': 'Annuler',
      'btn.save': 'Enregistrer',
      'btn.delete': 'Supprimer',
      'btn.add': 'Ajouter',
      'btn.back': 'Retour',
      'btn.refresh': 'Rafraîchir',

      'conn.online': 'Connecté',
      'conn.offline': 'Hors ligne',
      'conn.connecting': 'Connexion…',

      'home.adminTitle': 'Animer une session',
      'home.adminDesc':
        'Créez une session, projetez le code, et pilotez les événements round après round.',
      'home.sessionName': 'Nom de la session',
      'home.facilitator': 'Animateur (optionnel)',
      'home.createBtn': 'Créer la session',
      'home.resume': 'Reprendre ma dernière session animateur',
      'home.joinTitle': 'Rejoindre une partie',
      'home.joinDesc': 'Une équipe = un appareil. Saisissez le code affiché par l’animateur.',
      'home.code': 'Code de session',
      'home.teamName': 'Nom de votre équipe',
      'home.joinBtn': 'Rejoindre la partie',
      'home.resumeTeam': 'Revenir à ma table',
      'home.step1': 'L’animateur crée la session et projette le code',
      'home.step2': 'Chaque table rejoint et nomme son équipe',
      'home.step3': 'Un événement, un chrono, une décision A/B/C',
      'home.records': 'Historique des parties',
      'home.existing': 'Sessions ouvertes sur ce navigateur',

      'admin.title': 'Console animateur',
      'admin.code': 'Code de session',
      'admin.joinUrl': 'Lien joueurs',
      'admin.status.lobby': 'Salle d’attente',
      'admin.status.running': 'Partie en cours',
      'admin.status.finished': 'Session terminée',
      'admin.teams': 'Équipes',
      'admin.teamsCount': '{n} équipe(s)',
      'admin.noTeams': 'Aucune équipe pour l’instant. Projetez le code de session.',
      'admin.addTeam': 'Ajouter une équipe (saisie animateur)',
      'admin.deck': 'Déroulé des événements',
      'admin.launch': 'Lancer',
      'admin.relaunch': 'Rejouer',
      'admin.edit': 'Modifier',
      'admin.current': 'Événement en cours',
      'admin.noCurrent': 'Aucun événement en cours — lancez une carte depuis le déroulé.',
      'admin.close': 'Clore le vote',
      'admin.reveal': 'Révéler les résultats',
      'admin.next': 'Valider et passer au suivant',
      'admin.cancelRound': 'Annuler cet événement',
      'admin.pause': 'Pause',
      'admin.resume': 'Reprendre',
      'admin.addTime': '+30 s',
      'admin.lessTime': '−30 s',
      'admin.answered': '{n} / {total} réponses',
      'admin.answersLabel': 'Réponses',
      'card.situation': 'Situation',
      'card.motif': 'Motif',
      'card.impact': 'Impact',
      'admin.leaderboard': 'Classement général',
      'admin.settings': 'Réglages de la session',
      'admin.duration': 'Durée du vote (secondes)',
      'admin.autoReveal': 'Révéler automatiquement à la fin du temps',
      'admin.autoClose': 'Clore dès que toutes les équipes ont répondu',
      'admin.allowChange': 'Autoriser le changement de réponse avant la fin du temps',
      'admin.allowLateJoin': 'Autoriser les inscriptions en cours de partie',
      'admin.showBoard': 'Afficher le classement aux équipes',
      'admin.penalty': 'Pénalité si aucune réponse (0 ou négatif)',
      'admin.endSession': 'Terminer et archiver la session',
      'admin.reopen': 'Reprendre la session',
      'admin.endConfirm': 'Terminer la session et l’archiver dans l’historique ?',
      'admin.adjust': 'Ajuster le score',
      'admin.adjustHint': 'Points (+ ou −)',
      'admin.reason': 'Motif (optionnel)',
      'admin.adjustments': 'Ajustements manuels',
      'admin.override': 'Corriger une réponse',
      'admin.overrideHint': 'Choix retenu pour cette équipe',
      'admin.log': 'Journal de la session',
      'admin.newEvent': 'Créer un événement',
      'admin.editEvent': 'Modifier l’événement',
      'admin.eventAct': 'Acte',
      'admin.eventAct1': 'Acte 1 — court / long terme',
      'admin.eventAct2': 'Acte 2 — points',
      'admin.eventRound': 'Round / étape',
      'admin.eventRef': 'Référence (ex. Carte 7)',
      'admin.eventTag': 'Bandeau (ex. Incident client · Round 1)',
      'admin.eventTitle': 'Titre',
      'admin.eventSituation': 'Situation',
      'admin.eventMotif': 'Motifs (une ligne par point)',
      'admin.eventImpact': 'Impacts (une ligne par point)',
      'admin.eventTension': 'Tension (encadré)',
      'admin.eventColor': 'Couleur du bandeau',
      'admin.eventOptions': 'Options et barème',
      'admin.optLabel': 'Libellé',
      'admin.optShort': 'Court terme',
      'admin.optLong': 'Long terme',
      'admin.optPoints': 'Points',
      'admin.optReveal': 'Révélation (après le vote)',
      'admin.frLabel': 'Français',
      'admin.enLabel': 'English',
      'admin.deleteEvent': 'Supprimer cet événement',
      'admin.deleteEventConfirm': 'Supprimer cet événement du déroulé ?',
      'admin.removeTeamConfirm': 'Retirer cette équipe et ses points ?',
      'admin.projector': 'Mode projection',
      'admin.rounds': 'Historique des événements',
      'admin.noHistory': 'Aucun événement joué pour l’instant.',
      'admin.winnerOf': 'Gagnant',
      'admin.replayConfirm': 'Rejouer cet événement ? Les points déjà acquis sur cette carte seront remplacés.',
      'admin.projectHint': 'Projetez cet écran : les équipes votent sur leur téléphone.',
      'admin.roles': 'Rôles à distribuer (Acte 1)',

      'play.title': 'Espace équipe',
      'play.yourTeam': 'Votre équipe',
      'play.waiting': 'En attente du prochain événement',
      'play.waitingHint': 'Gardez cet écran ouvert. La carte apparaîtra automatiquement.',
      'play.chooseNow': 'Prenez votre décision : A, B ou C',
      'play.submitted': 'Réponse enregistrée',
      'play.submittedAt': 'Réponse enregistrée en {s} s',
      'play.locked': 'Vote clos',
      'play.timeLeft': 'Temps restant',
      'play.timeUp': 'Temps écoulé',
      'play.paused': 'En pause',
      'play.results': 'Résultats de l’événement',
      'play.winner': 'Gagnant de l’événement',
      'play.winners': 'Gagnants (ex æquo)',
      'play.noWinner': 'Aucune réponse — pas de gagnant',
      'play.youWin': 'Vous remportez cet événement',
      'play.myScore': 'Mon score',
      'play.roles': 'Rôles à distribuer autour de la table',
      'play.leaderboardHidden': 'Le classement est masqué par l’animateur jusqu’à la fin.',
      'play.sessionEnded': 'Session terminée — merci !',
      'play.finalProfile': 'Votre profil',
      'play.reveal': 'Ce que révèle votre choix',
      'play.answers': 'Réponses des équipes',
      'play.rename': 'Renommer l’équipe',
      'play.leave': 'Quitter',
      'play.leaveConfirm': 'Quitter la session sur cet appareil ?',
      'play.waitingReveal': 'Vote clos — résultats en cours d’annonce par l’animateur.',

      'score.short': 'Court terme',
      'score.long': 'Long terme',
      'score.act1': 'Acte 1',
      'score.act2': 'Acte 2',
      'score.adjust': 'Ajust.',
      'score.total': 'Total',
      'score.wins': 'Victoires',
      'score.rank': 'Rang',
      'score.team': 'Équipe',
      'score.choice': 'Choix',
      'score.points': 'Points',
      'score.seconds': 'Secondes',
      'score.profile1': 'Profil Acte 1',
      'score.profile2': 'Profil Acte 2',
      'score.noAnswer': 'Pas de réponse',
      'score.matrix': 'Barème',
      'score.event': 'Événement',

      'rec.title': 'Historique des parties',
      'rec.empty': 'Aucune partie archivée pour l’instant.',
      'rec.csv': 'Export Excel (CSV)',
      'rec.json': 'Export JSON',
      'rec.open': 'Détail',
      'rec.delete': 'Supprimer',
      'rec.deleteConfirm': 'Supprimer définitivement cet enregistrement ?',
      'rec.date': 'Date',
      'rec.session': 'Session',
      'rec.teamsCol': 'Équipes',
      'rec.eventsCol': 'Événements',
      'rec.winnerCol': 'Vainqueur',
      'rec.detail': 'Détail de la partie',
      'rec.standings': 'Classement final',
      'rec.events': 'Événements joués',
      'rec.adjustments': 'Ajustements manuels',
      'rec.duration': 'Durée',

      'log.session_created': 'Session créée : {name}',
      'log.team_joined': 'Équipe inscrite : {team}',
      'log.team_removed': 'Équipe retirée : {team}',
      'log.team_renamed': 'Équipe renommée : {from} → {team}',
      'log.round_started': 'Événement lancé : {event} ({seconds} s)',
      'log.team_submitted': '{team} a répondu {choice}',
      'log.round_closed': 'Vote clos : {event}',
      'log.round_revealed': 'Résultats révélés',
      'log.round_archived': 'Événement validé : {event}',
      'log.round_cancelled': 'Événement annulé : {event}',
      'log.round_paused': 'Chrono en pause',
      'log.round_resumed': 'Chrono relancé',
      'log.round_time_changed': 'Temps ajusté de {seconds} s',
      'log.score_adjusted': 'Score ajusté : {team} {delta} ({reason})',
      'log.score_adjust_removed': 'Ajustement annulé : {team} {delta}',
      'log.answer_overridden': 'Réponse corrigée : {team} → {choice} ({event})',
      'log.settings_updated': 'Réglages mis à jour',
      'log.session_ended': 'Session terminée et archivée',
      'log.session_reopened': 'Session reprise',
      'log.event_added': 'Événement ajouté : {event}',
      'log.event_updated': 'Événement modifié : {event}',
      'log.event_removed': 'Événement supprimé : {event}',

      'flash.round_started': 'Nouvel événement lancé',
      'flash.round_closed': 'Vote clos',
      'flash.round_revealed': 'Résultats révélés',
      'flash.round_timeout': 'Temps écoulé — vote clos',
      'flash.round_paused': 'Chrono en pause',
      'flash.round_resumed': 'Chrono relancé',
      'flash.score_adjusted': 'Score ajusté par l’animateur',
      'flash.session_ended': 'La session est terminée',

      'err.session_not_found': 'Session introuvable — vérifiez le code.',
      'err.forbidden': 'Accès refusé.',
      'err.unauthorized': 'Phrase d’accès animateur incorrecte.',
      'pass.prompt': 'Phrase d’accès animateur :',
      'err.name_taken': 'Ce nom d’équipe est déjà pris.',
      'err.bad_name': 'Nom trop court (2 caractères minimum).',
      'err.already_submitted': 'Votre réponse est déjà enregistrée.',
      'err.time_up': 'Temps écoulé — réponse refusée.',
      'err.no_teams': 'Inscrivez au moins une équipe avant de lancer un événement.',
      'err.round_open': 'Un événement est déjà en cours.',
      'err.no_open_round': 'Aucun événement ouvert.',
      'err.too_many_teams': 'Nombre maximum d’équipes atteint.',
      'err.join_closed': 'Les inscriptions sont fermées.',
      'err.session_finished': 'Cette session est terminée.',
      'err.bad_choice': 'Choix invalide.',
      'err.round_paused': 'Le chrono est en pause.',
      'err.not_joined': 'Session perdue — rechargez la page.',
      'err.network': 'Problème de connexion au serveur.',
      'err.generic': 'Une erreur est survenue.',
    },

    en: {
      'app.name': 'Serious Game',
      'app.title': 'E-invoicing',
      'app.tagline': 'The real match starts after go-live',
      'app.acts': 'Act 1 · Crisis committee — Act 2 · Choose your transformation',

      'nav.home': 'Home',
      'nav.admin': 'Facilitator console',
      'nav.play': 'Team space',
      'nav.records': 'Records',
      'nav.print': 'Print',

      'btn.create': 'Create session',
      'btn.join': 'Join',
      'btn.copy': 'Copy',
      'btn.copied': 'Copied',
      'btn.close': 'Close',
      'btn.cancel': 'Cancel',
      'btn.save': 'Save',
      'btn.delete': 'Delete',
      'btn.add': 'Add',
      'btn.back': 'Back',
      'btn.refresh': 'Refresh',

      'conn.online': 'Connected',
      'conn.offline': 'Offline',
      'conn.connecting': 'Connecting…',

      'home.adminTitle': 'Run a session',
      'home.adminDesc': 'Create a session, project the code, and drive the events round by round.',
      'home.sessionName': 'Session name',
      'home.facilitator': 'Facilitator (optional)',
      'home.createBtn': 'Create session',
      'home.resume': 'Resume my last facilitator session',
      'home.joinTitle': 'Join a game',
      'home.joinDesc': 'One team, one device. Enter the code shown by the facilitator.',
      'home.code': 'Session code',
      'home.teamName': 'Your team name',
      'home.joinBtn': 'Join the game',
      'home.resumeTeam': 'Back to my table',
      'home.step1': 'The facilitator creates the session and projects the code',
      'home.step2': 'Each table joins and names its team',
      'home.step3': 'One event, one timer, one A/B/C decision',
      'home.records': 'Past games',
      'home.existing': 'Sessions open on this browser',

      'admin.title': 'Facilitator console',
      'admin.code': 'Session code',
      'admin.joinUrl': 'Player link',
      'admin.status.lobby': 'Waiting room',
      'admin.status.running': 'Game running',
      'admin.status.finished': 'Session closed',
      'admin.teams': 'Teams',
      'admin.teamsCount': '{n} team(s)',
      'admin.noTeams': 'No team yet. Project the session code.',
      'admin.addTeam': 'Add a team (facilitator entry)',
      'admin.deck': 'Event run sheet',
      'admin.launch': 'Launch',
      'admin.relaunch': 'Replay',
      'admin.edit': 'Edit',
      'admin.current': 'Current event',
      'admin.noCurrent': 'No event running — launch a card from the run sheet.',
      'admin.close': 'Close the vote',
      'admin.reveal': 'Reveal results',
      'admin.next': 'Confirm and move on',
      'admin.cancelRound': 'Cancel this event',
      'admin.pause': 'Pause',
      'admin.resume': 'Resume',
      'admin.addTime': '+30 s',
      'admin.lessTime': '−30 s',
      'admin.answered': '{n} / {total} answers',
      'admin.answersLabel': 'Answers',
      'card.situation': 'Situation',
      'card.motif': 'Reason',
      'card.impact': 'Impact',
      'admin.leaderboard': 'Overall standings',
      'admin.settings': 'Session settings',
      'admin.duration': 'Vote duration (seconds)',
      'admin.autoReveal': 'Reveal automatically when time is up',
      'admin.autoClose': 'Close as soon as every team has answered',
      'admin.allowChange': 'Allow teams to change their answer before time is up',
      'admin.allowLateJoin': 'Allow teams to join after the game has started',
      'admin.showBoard': 'Show the standings to teams',
      'admin.penalty': 'Penalty when a team does not answer (0 or negative)',
      'admin.endSession': 'End and archive the session',
      'admin.reopen': 'Reopen the session',
      'admin.endConfirm': 'End the session and archive it in the records?',
      'admin.adjust': 'Adjust score',
      'admin.adjustHint': 'Points (+ or −)',
      'admin.reason': 'Reason (optional)',
      'admin.adjustments': 'Manual adjustments',
      'admin.override': 'Override an answer',
      'admin.overrideHint': 'Answer recorded for this team',
      'admin.log': 'Session log',
      'admin.newEvent': 'Create an event',
      'admin.editEvent': 'Edit event',
      'admin.eventAct': 'Act',
      'admin.eventAct1': 'Act 1 — short / long term',
      'admin.eventAct2': 'Act 2 — points',
      'admin.eventRound': 'Round / step',
      'admin.eventRef': 'Reference (e.g. Card 7)',
      'admin.eventTag': 'Banner (e.g. Customer incident · Round 1)',
      'admin.eventTitle': 'Title',
      'admin.eventSituation': 'Situation',
      'admin.eventMotif': 'Reasons (one per line)',
      'admin.eventImpact': 'Impacts (one per line)',
      'admin.eventTension': 'Tension (highlight box)',
      'admin.eventColor': 'Banner colour',
      'admin.eventOptions': 'Options and scoring',
      'admin.optLabel': 'Label',
      'admin.optShort': 'Short term',
      'admin.optLong': 'Long term',
      'admin.optPoints': 'Points',
      'admin.optReveal': 'Reveal (after the vote)',
      'admin.frLabel': 'Français',
      'admin.enLabel': 'English',
      'admin.deleteEvent': 'Delete this event',
      'admin.deleteEventConfirm': 'Remove this event from the run sheet?',
      'admin.removeTeamConfirm': 'Remove this team and its points?',
      'admin.projector': 'Projector mode',
      'admin.rounds': 'Event history',
      'admin.noHistory': 'No event played yet.',
      'admin.winnerOf': 'Winner',
      'admin.replayConfirm': 'Replay this event? Points already earned on this card will be replaced.',
      'admin.projectHint': 'Project this screen: teams vote on their phones.',
      'admin.roles': 'Roles to hand out (Act 1)',

      'play.title': 'Team space',
      'play.yourTeam': 'Your team',
      'play.waiting': 'Waiting for the next event',
      'play.waitingHint': 'Keep this screen open. The card will appear automatically.',
      'play.chooseNow': 'Make your decision: A, B or C',
      'play.submitted': 'Answer recorded',
      'play.submittedAt': 'Answer recorded in {s} s',
      'play.locked': 'Vote closed',
      'play.timeLeft': 'Time left',
      'play.timeUp': 'Time is up',
      'play.paused': 'Paused',
      'play.results': 'Event results',
      'play.winner': 'Event winner',
      'play.winners': 'Winners (tie)',
      'play.noWinner': 'No answer — no winner',
      'play.youWin': 'You win this event',
      'play.myScore': 'My score',
      'play.roles': 'Roles to hand out around the table',
      'play.leaderboardHidden': 'The facilitator keeps the standings hidden until the end.',
      'play.sessionEnded': 'Session closed — thank you!',
      'play.finalProfile': 'Your profile',
      'play.reveal': 'What your choice reveals',
      'play.answers': 'Team answers',
      'play.rename': 'Rename team',
      'play.leave': 'Leave',
      'play.leaveConfirm': 'Leave the session on this device?',
      'play.waitingReveal': 'Vote closed — the facilitator is about to announce the results.',

      'score.short': 'Short term',
      'score.long': 'Long term',
      'score.act1': 'Act 1',
      'score.act2': 'Act 2',
      'score.adjust': 'Adj.',
      'score.total': 'Total',
      'score.wins': 'Wins',
      'score.rank': 'Rank',
      'score.team': 'Team',
      'score.choice': 'Choice',
      'score.points': 'Points',
      'score.seconds': 'Seconds',
      'score.profile1': 'Act 1 profile',
      'score.profile2': 'Act 2 profile',
      'score.noAnswer': 'No answer',
      'score.matrix': 'Scoring',
      'score.event': 'Event',

      'rec.title': 'Past games',
      'rec.empty': 'No archived game yet.',
      'rec.csv': 'Excel export (CSV)',
      'rec.json': 'JSON export',
      'rec.open': 'Detail',
      'rec.delete': 'Delete',
      'rec.deleteConfirm': 'Permanently delete this record?',
      'rec.date': 'Date',
      'rec.session': 'Session',
      'rec.teamsCol': 'Teams',
      'rec.eventsCol': 'Events',
      'rec.winnerCol': 'Winner',
      'rec.detail': 'Game detail',
      'rec.standings': 'Final standings',
      'rec.events': 'Events played',
      'rec.adjustments': 'Manual adjustments',
      'rec.duration': 'Duration',

      'log.session_created': 'Session created: {name}',
      'log.team_joined': 'Team joined: {team}',
      'log.team_removed': 'Team removed: {team}',
      'log.team_renamed': 'Team renamed: {from} → {team}',
      'log.round_started': 'Event launched: {eventEn} ({seconds} s)',
      'log.team_submitted': '{team} answered {choice}',
      'log.round_closed': 'Vote closed: {eventEn}',
      'log.round_revealed': 'Results revealed',
      'log.round_archived': 'Event confirmed: {eventEn}',
      'log.round_cancelled': 'Event cancelled: {event}',
      'log.round_paused': 'Timer paused',
      'log.round_resumed': 'Timer resumed',
      'log.round_time_changed': 'Timer adjusted by {seconds} s',
      'log.score_adjusted': 'Score adjusted: {team} {delta} ({reason})',
      'log.score_adjust_removed': 'Adjustment removed: {team} {delta}',
      'log.answer_overridden': 'Answer overridden: {team} → {choice} ({event})',
      'log.settings_updated': 'Settings updated',
      'log.session_ended': 'Session ended and archived',
      'log.session_reopened': 'Session reopened',
      'log.event_added': 'Event added: {event}',
      'log.event_updated': 'Event updated: {event}',
      'log.event_removed': 'Event removed: {event}',

      'flash.round_started': 'New event launched',
      'flash.round_closed': 'Vote closed',
      'flash.round_revealed': 'Results revealed',
      'flash.round_timeout': 'Time is up — vote closed',
      'flash.round_paused': 'Timer paused',
      'flash.round_resumed': 'Timer resumed',
      'flash.score_adjusted': 'Score adjusted by the facilitator',
      'flash.session_ended': 'The session is closed',

      'err.session_not_found': 'Session not found — check the code.',
      'err.forbidden': 'Access denied.',
      'err.unauthorized': 'Wrong facilitator passphrase.',
      'pass.prompt': 'Facilitator passphrase:',
      'err.name_taken': 'That team name is already taken.',
      'err.bad_name': 'Name too short (2 characters minimum).',
      'err.already_submitted': 'Your answer is already recorded.',
      'err.time_up': 'Time is up — answer rejected.',
      'err.no_teams': 'Add at least one team before launching an event.',
      'err.round_open': 'An event is already running.',
      'err.no_open_round': 'No event is open.',
      'err.too_many_teams': 'Maximum number of teams reached.',
      'err.join_closed': 'Registration is closed.',
      'err.session_finished': 'This session is closed.',
      'err.bad_choice': 'Invalid choice.',
      'err.round_paused': 'The timer is paused.',
      'err.not_joined': 'Session lost — reload the page.',
      'err.network': 'Cannot reach the server.',
      'err.generic': 'Something went wrong.',
    },
  };

  const LS_KEY = 'sg.lang';
  let lang = 'fr';
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === 'fr' || saved === 'en') lang = saved;
    else if ((navigator.language || '').toLowerCase().startsWith('en')) lang = 'en';
  } catch (err) {
    /* stockage indisponible : on reste en français */
  }

  const listeners = new Set();

  function t(key, params) {
    const table = DICT[lang] || DICT.fr;
    let text = table[key];
    if (text === undefined) text = (DICT.fr[key] !== undefined ? DICT.fr[key] : key);
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (m, name) =>
        params[name] === undefined || params[name] === null ? '' : String(params[name])
      );
    }
    return text;
  }

  /** Résout un objet bilingue { fr, en } venant du serveur. */
  function L(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    return value[lang] || value.fr || value.en || '';
  }

  function setLang(next) {
    if (next !== 'fr' && next !== 'en') return;
    if (next === lang) return;
    lang = next;
    try {
      localStorage.setItem(LS_KEY, lang);
    } catch (err) {
      /* ignore */
    }
    document.documentElement.setAttribute('lang', lang);
    applyStatic();
    listeners.forEach((fn) => {
      try {
        fn(lang);
      } catch (err) {
        console.error(err);
      }
    });
  }

  function getLang() {
    return lang;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /** Traduit les éléments porteurs de data-i18n / data-i18n-placeholder / data-i18n-title. */
  function applyStatic(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.setAttribute('title', t(node.getAttribute('data-i18n-title')));
    });
    scope.querySelectorAll('[data-lang-btn]').forEach((node) => {
      node.classList.toggle('active', node.getAttribute('data-lang-btn') === lang);
    });
  }

  function errorText(code, fallback) {
    const key = `err.${code}`;
    const table = DICT[lang] || DICT.fr;
    if (table[key]) return table[key];
    return fallback || t('err.generic');
  }

  window.I18N = { t, L, setLang, getLang, onChange, applyStatic, errorText, DICT };
})();
