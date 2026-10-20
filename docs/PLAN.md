# Plan du projet Flowlab

## Objectif

Aider un débutant en rap (introspectif, mélancolique, planant) à **trouver et à garder un flow** sur
une prod. Le principe : on yaourte d'abord, sans chercher les mots ; ensuite, on vérifie que le texte
rentre dans le rythme.

**Hors périmètre, choix assumé** : aucune aide à l'écriture (pas de suggestions de mots, d'images ni
de rimes, pas de réécriture). L'app compte et place ; c'est toi qui écris.

## Les deux piliers

1. **Le BPM et la grille, en automatique** : tempo, premier temps, mesures et sections, avec des
   corrections faciles (÷2 / ×2, tap, décalage).
2. **Un schéma rythmique pour rester dans le temps** : la grille de la prod (kick et caisse claire
   affichés), un guide visuel en direct pendant l'enregistrement, la carte de flow après la prise,
   la prise fantôme et la comparaison des prises.

## Écrans

| Écran | Rôle |
|---|---|
| Projets | Liste des prods, import |
| Prod | Lecteur, BPM auto + corrections, grille, sections, métronome, repères |
| Yaourt | Enregistrement avec guide en direct, carte de flow, prises, comparaison |
| Texte | Texte collé ligne par ligne sur la grille : comptage des syllabes, alertes trop long / trop court |

## Étapes

| # | Livrable | État |
|---|---|---|
| 0 | Squelette, thème sombre, stockage local des projets | ✅ |
| 1 | Import, forme d'onde, lecture, boucle, 0,75x / 1x, repères | ✅ |
| 2 | BPM auto + confiance + ÷2 / ×2 + tap + métronome + grille de mesures | ✅ |
| 3 | Kick et caisse claire affichés sur une grille 16 cases par mesure + sections (intro, couplet…) calées sur les mesures | ✅ |
| 4 | Enregistrement au casque (`getUserMedia` sans traitement de la voix), calibration de la latence, plusieurs prises | à faire |
| 5 | Guide visuel en direct (curseur, pulsation, décompte, syllabes colorées en avance / dans le temps / en retard) + carte de flow (syllabes, accents, silences, syllabes par mesure, accélérations, motifs répétés) | à faire |
| 6 | Prise fantôme + comparaison A/B des prises | à faire |
| 7 | *(option)* Variantes rythmiques jouées en « ta-ta » : parlé lent, saccadé, mélodique, dense | à faire |
| 8 | Texte sur la grille : une ligne par mesure, compteur de syllabes en français (plage min–max pour le « e » muet et les élisions « j'suis », « p'tit »), alertes trop long / trop court / mal placé, explication courte du pourquoi. **Sans proposer de mots.** | à faire |

## Évolutions possibles de l'analyse

Chaque analyseur est une fonction pure (`analysis/*.js`) exécutée dans un Web Worker. On peut donc
remplacer un algorithme par une bibliothèque (essentia.js, aubio en WASM) ou par un modèle sans
toucher à l'interface :

- tempo variable : suivi des temps par programmation dynamique, si une prod n'est pas calée sur
  une grille fixe ;
- tonalité : chroma + profils de Krumhansl ;
- sections : la proposition actuelle (étape 3) compare niveau, brillance et batterie par blocs de
  4 mesures ; on pourrait y ajouter le chroma pour repérer un changement d'accords à batterie égale ;
- voix : noyaux syllabiques (énergie + voisement), accents (énergie + hauteur + durée).

## Limites techniques

- **BPM** : fiable sur une prod où la batterie est nette. Les confusions ÷2 / ×2 restent possibles,
  surtout sur le half-time, d'où les boutons. Une intro planante sans batterie donne une confiance
  faible : il faut alors utiliser « Détecter sur la boucle » sur un passage avec batterie.
- **Le « 1 »** se déduit du schéma « kick sur 1, caisse claire sur 2 et 4 ». Les prods trap (caisse
  claire sur le 3 en half-time) ou très syncopées peuvent le décaler d'un temps : il faut alors
  utiliser « ← 1 temps / 1 temps → ».
- **Batterie** : pensée pour un kick net dans le grave et une caisse claire (ou un clap) dans le
  médium. Une 808 longue et grave compte comme un kick à chaque attaque ; un clap superposé à la
  caisse claire est vu comme un seul coup ; les charleys ne sont pas affichés (ils restent en cases
  pâles côté caisse claire s'ils sont forts). Si la grille est fausse (BPM ou « 1 »), les coups
  tombent entre les cases : corriger la grille d'abord.
- **Sections proposées** : fiables sur les changements nets (batterie qui entre ou qui coupe, gros
  écart de niveau). Un refrain qui ne change que les accords ou la voix n'est pas repéré, et les
  noms (couplet, refrain) restent à donner à la main.
- **Tempo variable** (prod jouée sans clic, sample non calé) : la grille fixe dérive. Cas rare pour
  des prods produites dans un logiciel de MAO.
- **Synchro** : l'élément `<audio>` avance par à-coups ; l'horloge est donc extrapolée à partir de
  l'AudioContext. Si les clics du métronome semblent décalés, il faut ajuster « Calage clic ».
- **Enregistrement** (étape 4) : casque filaire obligatoire (le Bluetooth ajoute 150 à 300 ms) ; la
  latence est à calibrer une fois par appareil.
- **Yaourt** (étape 5) : la détection est bonne sur des syllabes nettes (« da / ta »), moins bonne
  sur un « mmmh » continu. Les comptes de syllabes sont approximatifs (±1 à 2).
- **YouTube** : le lecteur intégré ne peut pas être branché sur la Web Audio API, et télécharger
  l'audio est contraire aux conditions de YouTube. Le lien sert seulement de référence. Les prods
  « free » sont en général gratuites pour un usage non commercial uniquement : pour sortir un
  morceau, il faut une licence du beatmaker.
