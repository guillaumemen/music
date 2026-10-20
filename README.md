# Flowlab

Atelier de flow pour le rap, dans le navigateur. Tu importes une prod, l'app trouve son tempo et
dessine la grille des mesures ; tu yaourtes dessus au casque et tu vois ton flow sur la grille ;
puis tu poses ton texte ligne par ligne et l'app compte les syllabes par rapport à ton yaourt.

Flowlab **n'écrit pas à ta place** : il t'aide seulement à trouver et à garder le rythme.

## Ce qui marche aujourd'hui (étapes 0 à 6 et 8)

### Écran Prod

- **Projets** : import d'un MP3 / WAV (glisser-déposer ou sélection). Les fichiers restent dans le
  navigateur (IndexedDB). Rien n'est envoyé en ligne.
- **Lecteur** :
  - aperçu du morceau + forme d'onde zoomable, avec les numéros de mesure ;
  - lecture / pause, recul de 2 s, vitesse **0,75x sans changer la hauteur** ;
  - boucle de 1, 2, 4 ou 8 mesures à partir de la mesure en cours, ou boucle libre en glissant sur la
    forme d'onde (aimantée aux mesures) ;
  - repères nommés.
- **BPM automatique** :
  - détection à l'import, avec un indice de confiance ;
  - le « 1 » (premier temps) est placé à partir du kick et de la caisse claire ;
  - boutons ÷2 / ×2 (l'erreur classique sur les prods half-time) et tempos alternatifs proposés ;
  - tap tempo, saisie manuelle, « Le 1 est ici », décalage d'un temps ou de ±10 ms ;
  - détection sur la boucle seulement, quand l'intro n'a pas de batterie.
- **Indicateur de temps** : numéro de mesure + 4 pastilles qui s'allument sur chaque temps.
- **Métronome** calé sur la grille (clic aigu sur le 1), avec volume et calage en ms.
- **Batterie sur 16 cases** : kick et caisse claire lus sur chaque double croche de la mesure,
  en direct pendant la lecture (« Mesure en cours ») ou en « Motif type » (le schéma qui revient le
  plus souvent), avec une phrase qui le résume (« caisse claire sur le 2 et le 4 », half-time…).
  Les coups apparaissent aussi en bas de la forme d'onde. Clic sur une case : aller à cet instant.
- **Sections** (intro, couplet, refrain…) calées sur les mesures : ajout à la mesure en cours
  (`N`), nom libre ou proposé, début modifiable, boucle d'une section en un clic. « Proposer »
  repère les changements (entrée / arrêt de la batterie, niveau, brillance) et nomme les parties qui
  se ressemblent avec la même lettre ; tu renommes ensuite.
- **Infos** : tonalité saisie à la main, lien de la prod (simple référence, YouTube n'est ni lu ni
  téléchargé).

### Écran Yaourt

- **Enregistrement au casque** : micro sans traitement (ni annulation d'écho, ni réduction de
  bruit, ni gain automatique), sur un **passage** au choix : une section, la boucle, ou librement
  depuis la mesure en cours. Une passe par prise, avec un décompte d'une mesure.
- **Calibration de la latence** (une fois par appareil) : 12 clics, tu dis « ta » sur les 8
  derniers ; l'app mesure le décalage casque + micro + réflexe et cale tes prises dessus.
- **Guide visuel en direct** : les mesures du passage en lignes de 16 cases, curseur, pulsation des
  temps, décompte en grand, et chaque syllabe qui apparaît pendant que tu yaourtes, colorée
  **dans le temps / en avance / en retard** (gros point = accent). Kick et caisse claire en fond.
- **Carte de flow** de la prise A : syllabes par mesure, part dans le temps, tendance avance /
  retard, accents, silences (respirations d'un temps ou plus), accélérations / ralentissements, et
  **motifs** rythmiques qui reviennent (même lettre = même placement).
- **Prises** : autant que tu veux, renommables. **Prise fantôme** : une ancienne prise affichée en
  cercles (et audible si tu veux) pendant que tu en enregistres une nouvelle. **Comparaison A / B** :
  deux prises côte à côte (densité, placement, accents), et « Écouter A / B » pour passer de l'une à
  l'autre sans couper la prod.

### Écran Texte

- Une ligne de texte = une mesure, à partir d'une mesure ou d'une section au choix.
- **Comptage des syllabes en français**, en plage min–max : les « e » muets (en italique) peuvent
  s'avaler (« sam(e)di », « (je) suis »), les élisions écrites comptent comme écrites (« j'suis »,
  « p'tit »), la diérèse peut ajouter une syllabe (« pas-si-on »).
- Comparaison avec le **nombre de syllabes de ton yaourt** sur la mesure (ou une cible fixe) :
  ça rentre / presque / trop long / trop court, avec le pourquoi en une phrase.
- **Accent décalé** : la dernière syllabe forte de la ligne tombe-t-elle sur un accent du yaourt ?
- Les syllabes du texte sont posées sur celles du yaourt, case par case.
- **Aucun mot n'est proposé** : pas de rimes, pas de suggestions, pas de réécriture.

## Lancer l'app

Aucune dépendance à installer, il suffit d'un serveur statique (le micro exige `localhost` ou
HTTPS) :

```bash
npm start            # = npx serve -l 5173 .
# ou : python3 -m http.server 5173
```

Puis ouvre <http://localhost:5173> dans Chrome, Edge ou Firefox. **Utilise un casque filaire.**

Sous Windows, tu peux aussi double-cliquer sur `Lancer Flowlab.bat` : il démarre le serveur et ouvre
le navigateur. Ferme la fenêtre noire pour arrêter.

### Avec Docker (Docker Desktop)

```bash
docker compose up -d --build     # construit l'image flowlab et lance le conteneur
```

L'app est servie par nginx sur <http://localhost:5173>. Le conteneur redémarre tout seul avec Docker
Desktop (`restart: unless-stopped`). Pour l'arrêter : `docker compose down`. Après une modification
du code, relance `docker compose up -d --build`.

Le lanceur `.bat` et le conteneur utilisent tous les deux le port 5173 : n'en lance qu'un à la fois.
Les prods importées restent dans le navigateur (IndexedDB), pas dans le conteneur.

## Raccourcis

| Touche | Action |
|---|---|
| `Espace` | Lecture / pause |
| `←` `→` | ±2 s (`Maj` : ±1 mesure) |
| `L` | Boucle on/off |
| `[` `]` | Début / fin de boucle à la tête de lecture |
| `S` | 0,75x / 1x |
| `K` | Métronome |
| `T` | Tap tempo |
| `M` | Repère |
| `N` | Section à la mesure en cours |
| `R` | Yaourt : enregistrer / arrêter une prise (`Échap` : annuler) |
| `A` `B` | Yaourt : écouter la prise A / B |

## Tests

```bash
npm test
```

Les tests génèrent des prods synthétiques (kick, caisse claire, charley, nappe) à différents
tempos (65 à 160 BPM, BPM non entier, intro sans batterie, swing). Ils vérifient :

- le BPM trouvé ;
- la position du « 1 », à 10 ms près ;
- le kick et la caisse claire sur les bonnes cases (charley non confondu avec la caisse claire) ;
- les sections proposées (intro sans batterie, break, frontières à la mesure près) ;
- les syllabes d'un yaourt synthétique (« da-da »), à 10 ms près, ses accents, en direct comme après
  la prise ;
- la carte de flow (avance / retard, motifs, accélérations, silences) ;
- le comptage des syllabes en français sur une trentaine de mots et de lignes ;
- la logique de grille, des sections et le tap tempo.

## Organisation du code

```
index.html            page unique
src/
  main.js             contrôleur de l'interface (écrans, raccourcis, boucle d'affichage)
  styles.css          thème sombre
  core/               logique pure : grille rythmique, sections, carte de flow, syllabes du français,
                      tap tempo, modèle de projet, formatage
  audio/              lecteur (Web Audio + <audio>), métronome programmé à l'avance, micro
                      (AudioWorklet horodaté) et lecture des prises
  analysis/           tempo (FFT, flux spectral, autocorrélation, grille), batterie en 16 cases,
                      proposition de sections, syllabes de la voix + Web Worker
  screens/            écrans Yaourt et Texte
  ui/                 forme d'onde et grille sur <canvas>
  store/              IndexedDB
tests/                tests Node (node --test)
docs/PLAN.md          plan complet du projet
```

## Comment marche la détection du BPM

1. Le morceau est mixé en mono puis sous-échantillonné à ~22 kHz.
2. Le **flux spectral** est calculé : une trame toutes les ~12 ms, en mesurant l'augmentation
   d'énergie entre deux trames. Il est calculé sur tout le spectre, sur la bande grave (kick,
   < 150 Hz) et sur la bande médium (caisse claire).
3. Une **autocorrélation** de cette courbe d'attaques fait ressortir la période qui revient le plus
   souvent. Elle est pondérée par une légère préférence pour les tempos rap (centre 90 BPM).
4. Une **grille constante** (BPM au centième + phase) est ajustée sur les attaques, puis arrondie à
   un BPM entier ou demi quand ça explique aussi bien le signal.
5. Le « 1 » est le temps qui maximise « kick sur le 1, caisse claire sur le 2 et le 4 ».

## Comment marche la grille de batterie

Pour chaque case (double croche) de chaque mesure, l'app lit la force des attaques autour de
l'instant de la case : bande grave pour le kick, bande médium pour la caisse claire. Ici le flux est
calculé en magnitude linéaire (sans log) : sinon un charley discret pèserait presque autant qu'une
caisse claire. Une part de chaque bande est retirée de l'autre (le grave d'une caisse claire, le
claquement d'un kick). Les forces sont ramenées entre 0 et 1 par rapport à un coup typique du
morceau : au-dessus de 0,5, c'est un coup. Tout est recalculé quand la grille change (BPM, « 1 »).

## Comment le yaourt est calé sur la prod

Le micro est capté par un AudioWorklet, qui donne l'instant exact de chaque échantillon sur
l'horloge Web Audio (la même que le métronome). Une syllabe captée à l'instant C correspond à ce que
tu entendais dans la prod à `C − latence`. La latence (sortie casque + entrée micro + ton propre
réflexe) se mesure avec la calibration.

Les syllabes sont repérées sur l'énergie de la voix (fenêtre de 20 ms toutes les 5 ms) : une
syllabe commence quand l'énergie remonte nettement après un creux (la consonne). Après la prise,
chaque syllabe reçoit sa hauteur (autocorrélation) ; un accent est une syllabe plus forte que la
moyenne, ou plus haute et plus longue. Chaque syllabe est ensuite rattachée à la double croche la
plus proche : à moins de 35 ms, elle est « dans le temps ».

Les limites connues sont dans [docs/PLAN.md](docs/PLAN.md#limites-techniques).
