'use strict';

/**
 * Contenu du jeu / Game content.
 *
 * Acte 1 — Comité de crise : 4 cartes incidents sur 3 rounds de 6 min.
 * Acte 2 — Choose your transformation : 4 étapes de décision.
 *
 * Barème unique aux deux actes (carte de scoring « Compter les points ») :
 *   A court terme = 0 · B équilibré = +2 · C structurant = +4.
 * Soit 4 décisions × 4 points = 16 points maximum par acte.
 *
 * Chaque texte est bilingue : { fr, en }.
 */

/** Barème partagé par les deux actes. */
const OPTION_POINTS = { A: 0, B: 2, C: 4 };

/** Étiquettes du barème, telles qu'elles figurent sur la carte de scoring. */
const OPTION_TIERS = {
  A: { fr: 'Court terme', en: 'Short term' },
  B: { fr: 'Équilibré', en: 'Balanced' },
  C: { fr: 'Structurant', en: 'Structural' },
};

function options(list) {
  return list.map((opt) => ({
    key: opt.key,
    label: opt.label,
    points: OPTION_POINTS[opt.key],
    reveal: opt.reveal || null,
  }));
}

const DEFAULT_EVENTS = [
  {
    id: 'act1-card1',
    act: 1,
    round: 1,
    ref: { fr: 'Carte 1', en: 'Card 1' },
    tag: { fr: 'Incident opérationnel · Round 1', en: 'Operational incident · Round 1' },
    color: 'red',
    title: { fr: 'Factures rejetées', en: 'Rejected invoices' },
    situation: {
      fr: '8 % de vos factures sont rejetées par les plateformes de vos clients.',
      en: '8% of your invoices are rejected by your customers’ platforms.',
    },
    motif: [
      {
        fr: 'SIREN erroné (adresse de facturation incorrecte)',
        en: 'Incorrect company ID (wrong billing address)',
      },
      {
        fr: 'Prix unitaire des biens livrés incohérent avec les négociations commerciales',
        en: 'Unit price of the delivered goods inconsistent with the commercial terms',
      },
    ],
    impact: [
      { fr: 'Retards de paiement', en: 'Payment delays' },
      { fr: 'Saturation des équipes', en: 'Teams overloaded' },
      { fr: 'Perte de crédibilité client', en: 'Loss of customer credibility' },
    ],
    tension: null,
    options: options([
      { key: 'A', label: { fr: 'Correction manuelle rapide', en: 'Quick manual fix' } },
      { key: 'B', label: { fr: 'Patch IT ciblé', en: 'Targeted IT patch' } },
      { key: 'C', label: { fr: 'Audit global des données', en: 'Full data audit' } },
    ]),
  },
  {
    id: 'act1-card2',
    act: 1,
    round: 2,
    ref: { fr: 'Carte 2', en: 'Card 2' },
    tag: { fr: 'Escalade fiscale · Round 2', en: 'Tax escalation · Round 2' },
    color: 'red',
    title: { fr: 'DGFIP — incohérences', en: 'Tax authority — inconsistencies' },
    situation: {
      fr: 'L’administration détecte des anomalies et demande une explication formelle.',
      en: 'The tax authority detects anomalies and requests a formal explanation.',
    },
    motif: [
      {
        fr: 'Écarts de TVA (montants sur factures v. CA3)',
        en: 'VAT discrepancies (invoice amounts vs. VAT return)',
      },
      {
        fr: 'Anomalies sur les codes VATEX v. détail à la ligne des opérations',
        en: 'VATEX code anomalies vs. the line-level detail of the transactions',
      },
    ],
    impact: [
      { fr: 'Risque de redressement fiscal', en: 'Risk of a tax reassessment' },
      { fr: 'Exposition financière', en: 'Financial exposure' },
    ],
    tension: null,
    options: options([
      { key: 'A', label: { fr: 'Justification a posteriori', en: 'After-the-fact justification' } },
      { key: 'B', label: { fr: 'Correction ciblée', en: 'Targeted correction' } },
      {
        key: 'C',
        label: {
          fr: 'Revue complète du paramétrage de l’ERP et des applicatifs amont',
          en: 'Full review of the ERP and upstream application settings',
        },
      },
    ]),
  },
  {
    id: 'act1-card3',
    act: 1,
    round: 2,
    ref: { fr: 'Carte 3', en: 'Card 3' },
    tag: { fr: 'Audit interne · Round 2', en: 'Internal audit · Round 2' },
    color: 'red',
    title: { fr: 'Alerte sur les contrôles', en: 'Controls alert' },
    situation: {
      fr: 'L’audit interne alerte le comité sur la fragilité du dispositif.',
      en: 'Internal audit warns the committee that the setup is fragile.',
    },
    motif: [
      {
        fr: 'Absence de contrôle de la data (exhaustivité, qualité)',
        en: 'No data controls (completeness, quality)',
      },
      { fr: 'Dépendance excessive à la PA', en: 'Excessive dependency on the accredited platform' },
    ],
    impact: [
      { fr: 'Fragilité du dispositif', en: 'Fragile setup' },
      { fr: 'Risque non maîtrisé', en: 'Unmanaged risk' },
    ],
    tension: null,
    options: options([
      { key: 'A', label: { fr: 'Minimiser : normal en post go-live', en: 'Play it down: normal after go-live' } },
      { key: 'B', label: { fr: 'Plan de remédiation léger', en: 'Light remediation plan' } },
      { key: 'C', label: { fr: 'Refonte du dispositif de contrôle', en: 'Redesign the control framework' } },
    ]),
  },
  {
    id: 'act1-card4',
    act: 1,
    round: 3,
    ref: { fr: 'Carte 4', en: 'Card 4' },
    tag: { fr: 'Crise réputation · Round 3', en: 'Reputation crisis · Round 3' },
    color: 'red',
    title: { fr: 'Article de presse', en: 'Press article' },
    situation: {
      fr: 'Un article paraît : « Grand groupe X en difficulté sur la facturation électronique ».',
      en: 'An article is published: “Major group X struggling with e-invoicing”.',
    },
    motif: [],
    impact: [
      { fr: 'Image dégradée', en: 'Damaged image' },
      { fr: 'Pression interne et externe', en: 'Internal and external pressure' },
      { fr: 'Mobilisation de la direction générale', en: 'Executive committee mobilised' },
    ],
    tension: null,
    options: options([
      { key: 'A', label: { fr: 'Communication + correctifs rapides', en: 'Communication + quick fixes' } },
      { key: 'B', label: { fr: 'Programme de stabilisation', en: 'Stabilisation programme' } },
      {
        key: 'C',
        label: { fr: 'Repositionnement stratégique data et fiscal', en: 'Strategic data and tax repositioning' },
      },
    ]),
  },
  {
    id: 'act2-step1',
    act: 2,
    round: 1,
    ref: { fr: 'Étape 1/4', en: 'Step 1/4' },
    tag: { fr: 'Transformation · Stabilisation', en: 'Transformation · Stabilisation' },
    color: 'blue',
    title: { fr: 'Stabiliser ou investir ?', en: 'Stabilise or invest?' },
    situation: {
      fr: 'Votre solution fonctionne, mais elle génère 7 % d’erreurs et un volume élevé de corrections manuelles.',
      en: 'Your solution works, but it generates 7% errors and a high volume of manual corrections.',
    },
    motif: [],
    impact: [],
    tension: { fr: 'Pression forte des équipes', en: 'Strong pressure from the teams' },
    options: options([
      {
        key: 'A',
        label: { fr: 'Corriger au fil de l’eau', en: 'Fix as you go' },
        reveal: { fr: 'Rapide, mais dette cachée', en: 'Fast, but hidden debt' },
      },
      {
        key: 'B',
        label: { fr: 'Corriger les cas critiques', en: 'Fix the critical cases' },
        reveal: { fr: 'Amélioration partielle', en: 'Partial improvement' },
      },
      {
        key: 'C',
        label: { fr: 'Lancer un diagnostic complet de la data', en: 'Launch a full data diagnostic' },
        reveal: { fr: 'Effort élevé, base saine', en: 'High effort, healthy foundation' },
      },
    ]),
  },
  {
    id: 'act2-step2',
    act: 2,
    round: 2,
    ref: { fr: 'Étape 2/4', en: 'Step 2/4' },
    tag: { fr: 'Transformation · Risque fiscal', en: 'Transformation · Tax risk' },
    color: 'blue',
    title: { fr: 'Maîtrise ou réaction ?', en: 'Control or reaction?' },
    situation: {
      fr: 'Les premières incohérences sont détectées dans les données de TVA.',
      en: 'The first inconsistencies are detected in the VAT data.',
    },
    motif: [],
    impact: [],
    tension: { fr: 'Risque de contrôle fiscal ciblé', en: 'Risk of a targeted tax audit' },
    options: options([
      {
        key: 'A',
        label: { fr: 'Gérer les anomalies au cas par cas', en: 'Handle anomalies case by case' },
        reveal: { fr: 'Effet pansement', en: 'Sticking-plaster effect' },
      },
      {
        key: 'B',
        label: { fr: 'Renforcer les contrôles existants', en: 'Strengthen existing controls' },
        reveal: { fr: 'Contrôle mais incomplet', en: 'Some control, but incomplete' },
      },
      {
        key: 'C',
        label: { fr: 'Repenser la logique fiscale', en: 'Rethink the tax logic' },
        reveal: { fr: 'Sécurisation durable', en: 'Lasting protection' },
      },
    ]),
  },
  {
    id: 'act2-step3',
    act: 2,
    round: 3,
    ref: { fr: 'Étape 3/4', en: 'Step 3/4' },
    tag: { fr: 'Transformation · Data vs IT', en: 'Transformation · Data vs IT' },
    color: 'blue',
    title: { fr: 'Qui pilote ?', en: 'Who is in charge?' },
    situation: {
      fr: 'Les problèmes viennent des données, des référentiels et du mapping. L’IT propose une solution technique rapide.',
      en: 'The problems come from data, master data and mapping. IT proposes a quick technical fix.',
    },
    motif: [],
    impact: [],
    tension: { fr: 'Arbitrage de gouvernance', en: 'Governance trade-off' },
    options: options([
      {
        key: 'A',
        label: { fr: 'Laisser l’IT gérer', en: 'Let IT handle it' },
        reveal: { fr: 'Solution technique limitée', en: 'Limited technical fix' },
      },
      {
        key: 'B',
        label: { fr: 'Co-pilotage IT / fiscal', en: 'Joint IT / tax steering' },
        reveal: { fr: 'Compromis efficace', en: 'Effective compromise' },
      },
      {
        key: 'C',
        label: { fr: 'Gouvernance data transverse', en: 'Cross-functional data governance' },
        reveal: { fr: 'Transformation en profondeur', en: 'Deep transformation' },
      },
    ]),
  },
  {
    id: 'act2-step4',
    act: 2,
    round: 4,
    ref: { fr: 'Étape 4/4', en: 'Step 4/4' },
    tag: { fr: 'Transformation · Vision', en: 'Transformation · Vision' },
    color: 'blue',
    title: { fr: 'Ambitieux ou minimaliste ?', en: 'Ambitious or minimalist?' },
    situation: {
      fr: 'Trois trajectoires s’offrent à vous : stabiliser, optimiser ou transformer.',
      en: 'Three trajectories are open to you: stabilise, optimise or transform.',
    },
    motif: [],
    impact: [],
    tension: {
      fr: 'Budget limité + pression de la direction générale',
      en: 'Limited budget + pressure from the CEO',
    },
    options: options([
      {
        key: 'A',
        label: { fr: 'Stabilisation minimale', en: 'Minimal stabilisation' },
        reveal: { fr: 'Conformité fragile', en: 'Fragile compliance' },
      },
      {
        key: 'B',
        label: { fr: 'Optimisation progressive', en: 'Progressive optimisation' },
        reveal: { fr: 'Trajectoire solide', en: 'Solid trajectory' },
      },
      {
        key: 'C',
        label: { fr: 'Transformation data-driven', en: 'Data-driven transformation' },
        reveal: { fr: 'Avantage compétitif', en: 'Competitive advantage' },
      },
    ]),
  },
];

/** Récit d'ouverture lu avant le premier événement (script du kit de cartes). */
const NARRATIVE = {
  eyebrow: { fr: 'À lire à voix haute · Acte 1', en: 'Read aloud · Act 1' },
  title: { fr: 'Comité de crise', en: 'Crisis committee' },
  lines: [
    { fr: 'Nous sommes le 8 octobre 2026.', en: 'It is 8 October 2026.' },
    {
      fr: 'Votre entreprise est conforme… techniquement. Les factures passent, la plateforme est en place.',
      en: 'Your company is compliant… technically. Invoices go through, the platform is live.',
    },
    {
      fr: 'Mais depuis 30 jours, les signaux faibles s’accumulent. Vous êtes réunis en comité de crise.',
      en: 'But for 30 days the warning signs have been piling up. You are gathered in a crisis committee.',
    },
    {
      fr: 'Vos décisions dans les 60 prochaines minutes vont déterminer votre exposition fiscale, vos relations clients et votre performance financière.',
      en: 'Your decisions over the next 60 minutes will determine your tax exposure, your customer relationships and your financial performance.',
    },
  ],
  punch: {
    fr: 'Bienvenue dans le vrai monde de la facturation électronique.',
    en: 'Welcome to the real world of electronic invoicing.',
  },
  instruction: {
    fr: 'Chacun défend son point de vue — mais la table doit trancher collectivement.',
    en: 'Everyone defends their own view, but the table has to decide together.',
  },
};

const ROLES = [
  {
    id: 'role-fiscal',
    icon: 'scale',
    name: { fr: 'Directeur fiscal', en: 'Head of Tax' },
    mission: {
      fr: 'Arbitrer la position TVA, la réponse à l’administration et le sort de la CA3.',
      en: 'Decide the VAT position, the response to the tax authority and the fate of the VAT return.',
    },
    focus: { fr: 'Sécuriser le fond avant la forme.', en: 'Secure substance before form.' },
    quote: {
      fr: '« Avant de ré-émettre des factures électroniques : quel est l’impact TVA chiffré ? »',
      en: '“Before we reissue any e-invoices: what is the quantified VAT impact?”',
    },
    stance: {
      fr: 'Vous portez l’exposition au contrôle. Exigez des chiffres avant toute décision.',
      en: 'You carry the audit exposure. Demand figures before any decision.',
    },
  },
  {
    id: 'role-daf',
    icon: 'cash',
    name: { fr: 'DAF / Trésorerie', en: 'CFO / Treasury' },
    mission: {
      fr: 'Préserver la trésorerie et le BFR malgré les paiements bloqués.',
      en: 'Protect cash and working capital despite the frozen payments.',
    },
    focus: { fr: 'Encaisser, vite.', en: 'Collect cash, fast.' },
    quote: {
      fr: '« Le client à 20 % du CA ne paie plus — il me faut du cash cette semaine. »',
      en: '“The customer worth 20% of revenue has stopped paying. I need cash this week.”',
    },
    stance: {
      fr: 'Vous portez le cash et le résultat. Chiffrez le coût de chaque semaine perdue.',
      en: 'You carry cash and earnings. Quantify the cost of every week lost.',
    },
  },
  {
    id: 'role-dsi',
    icon: 'chip',
    name: { fr: 'DSI / Chef de projet e-invoicing', en: 'CIO / E-invoicing project lead' },
    mission: {
      fr: 'Diagnostiquer la cause technique et piloter la plateforme.',
      en: 'Diagnose the technical root cause and steer the platform.',
    },
    focus: { fr: 'Corriger le mapping, traiter les rejets.', en: 'Fix the mapping, clear the rejections.' },
    quote: {
      fr: '« Je peux relancer un batch de 28 000 factures ce soir. »',
      en: '“I can rerun a batch of 28,000 invoices tonight.”',
    },
    stance: {
      fr: 'Vous portez la faisabilité. Dites ce qui est possible — et à quel risque.',
      en: 'You carry feasibility. Say what is possible, and at what risk.',
    },
  },
  {
    id: 'role-juridique',
    icon: 'gavel',
    name: { fr: 'Direction juridique', en: 'Legal' },
    mission: {
      fr: 'Sécuriser la relation avec l’administration et qualifier l’erreur.',
      en: 'Secure the relationship with the tax authority and qualify the error.',
    },
    focus: {
      fr: 'Délais, régularisation, opposabilité.',
      en: 'Deadlines, voluntary disclosure, enforceability.',
    },
    quote: {
      fr: '« Tout ce qu’on écrit à l’administration nous engage. »',
      en: '“Everything we write to the authority binds us.”',
    },
    stance: {
      fr: 'Vous portez l’opposabilité. Rappelez ce qui engage l’entreprise.',
      en: 'You carry enforceability. Remind everyone what binds the company.',
    },
  },
  {
    id: 'role-clients',
    icon: 'handshake',
    name: { fr: 'Relation clients', en: 'Customer relations' },
    mission: {
      fr: 'Tenir la relation avec les clients bloqués et cadrer la communication.',
      en: 'Hold the relationship with blocked customers and frame the messaging.',
    },
    focus: { fr: 'Éviter la rupture commerciale.', en: 'Avoid a commercial breakdown.' },
    quote: {
      fr: '« Que dit-on au client, et sous quel délai ? »',
      en: '“What do we tell the customer, and by when?”',
    },
    stance: {
      fr: 'Vous portez la relation client. Défendez le délai et la clarté du message.',
      en: 'You carry the customer relationship. Defend the deadline and a clear message.',
    },
  },
  {
    id: 'role-dg',
    icon: 'crown',
    dg: true,
    name: { fr: 'Direction générale / Communication', en: 'CEO / Communications' },
    mission: {
      fr: 'Arbitrer les priorités, gérer l’escalade et l’image de l’entreprise.',
      en: 'Set priorities, manage escalation and protect the company image.',
    },
    focus: { fr: 'Décision et cohérence d’ensemble.', en: 'Decision and overall consistency.' },
    quote: {
      fr: '« Une seule voix vers l’extérieur. On tranche. »',
      en: '“One voice to the outside. We decide.”',
    },
    stance: {
      fr: 'Vous portez l’arbitrage final. Forcez la décision avant la fin du temps.',
      en: 'You carry the final call. Force the decision before time runs out.',
    },
    power: {
      fr: 'En cas d’égalité des votes, c’est vous qui tranchez pour toute l’équipe.',
      en: 'If the vote is tied, you make the final call for the whole team.',
    },
  },
];

function dgRole() {
  return ROLES.find((r) => r.dg) || ROLES[ROLES.length - 1];
}

function roleById(roleId) {
  return ROLES.find((r) => r.id === roleId) || null;
}

/** Profils Acte 1 : bornes sur les points cumulés (0 à 16), comme l'Acte 2. */
const ACT1_PROFILES = [
  {
    id: 'firefighter',
    max: 4,
    label: { fr: 'Firefighter', en: 'Firefighter' },
    desc: { fr: 'Vous subissez la réforme', en: 'The reform is happening to you' },
  },
  {
    id: 'conforme-fragile',
    max: 8,
    label: { fr: 'Conforme fragile', en: 'Fragile compliance' },
    desc: { fr: 'Conforme, mais dépendant des corrections', en: 'Compliant, but dependent on fixes' },
  },
  {
    id: 'en-controle',
    max: 12,
    label: { fr: 'En contrôle', en: 'In control' },
    desc: { fr: 'Dispositif maîtrisé et outillé', en: 'Framework mastered and tooled' },
  },
  {
    id: 'data-driven-leader',
    max: Infinity,
    label: { fr: 'Data driven leader', en: 'Data-driven leader' },
    desc: { fr: 'La data devient un avantage compétitif', en: 'Data becomes a competitive advantage' },
  },
];

/** Profils Acte 2 : bornes sur les points cumulés (0 à 16). */
const ACT2_PROFILES = [
  {
    id: 'survivor',
    max: 4,
    label: { fr: 'Survivor', en: 'Survivor' },
    desc: {
      fr: 'Gestion court terme · vulnérabilité élevée · risque fiscal latent',
      en: 'Short-term management · high vulnerability · latent tax risk',
    },
  },
  {
    id: 'compliant',
    max: 8,
    label: { fr: 'Compliant', en: 'Compliant' },
    desc: {
      fr: 'Conforme mais fragile · dépendant des corrections',
      en: 'Compliant but fragile · dependent on fixes',
    },
  },
  {
    id: 'controller',
    max: 12,
    label: { fr: 'Controller', en: 'Controller' },
    desc: {
      fr: 'Maîtrise croissante · gouvernance et contrôles en place',
      en: 'Growing control · governance and controls in place',
    },
  },
  {
    id: 'data-leader',
    max: Infinity,
    label: { fr: 'Data Leader', en: 'Data Leader' },
    desc: {
      fr: 'Pilotage par la data · avantage compétitif · fiscal stratégique',
      en: 'Data-driven steering · competitive advantage · strategic tax function',
    },
  },
];

function profileFor(profiles, score) {
  for (const p of profiles) {
    if (score <= p.max) return { id: p.id, label: p.label, desc: p.desc };
  }
  const last = profiles[profiles.length - 1];
  return { id: last.id, label: last.label, desc: last.desc };
}

function cloneDefaultEvents() {
  return JSON.parse(JSON.stringify(DEFAULT_EVENTS));
}

module.exports = {
  OPTION_POINTS,
  OPTION_TIERS,
  DEFAULT_EVENTS,
  NARRATIVE,
  ROLES,
  ACT1_PROFILES,
  ACT2_PROFILES,
  cloneDefaultEvents,
  profileFor,
  dgRole,
  roleById,
};
