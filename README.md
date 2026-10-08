# Flowlab

Atelier de flow pour le rap, dans le navigateur. Tu importes une prod, l'app trouve son tempo et
dessine la grille des mesures, puis (prochaines étapes) tu yaourtes dessus et tu vois ton flow sur
la grille.

Flowlab **n'écrit pas à ta place** : il t'aide seulement à trouver et à garder le rythme.

## Ce qui marche aujourd'hui (étapes 0 à 2)

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
- **Infos** : tonalité saisie à la main, lien de la prod (simple référence, YouTube n'est ni lu ni
  téléchargé).

## Lancer l'app

Aucune dépendance à installer, il suffit d'un serveur statique (le micro, aux étapes suivantes,
exige `localhost` ou HTTPS) :

```bash
npm start            # = npx serve -l 5173 .
# ou : python3 -m http.server 5173
```

Puis ouvre <http://localhost:5173> dans Chrome, Edge ou Firefox. **Utilise un casque filaire.**

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

## Tests

```bash
npm test
```

Les tests génèrent des prods synthétiques (kick, caisse claire, charley, nappe) à différents
tempos (65 à 160 BPM, BPM non entier, intro sans batterie, swing). Ils vérifient :

- le BPM trouvé ;
- la position du « 1 », à 10 ms près ;
- la logique de grille et le tap tempo.

## Organisation du code

```
index.html            page unique
src/
  main.js             contrôleur de l'interface (écrans, raccourcis, boucle d'affichage)
  styles.css          thème sombre
  core/               logique pure : grille rythmique, tap tempo, modèle de projet, formatage
  audio/              lecteur (Web Audio + <audio>), métronome programmé à l'avance
  analysis/           détection du tempo (FFT, flux spectral, autocorrélation, grille) + Web Worker
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

Les limites connues sont dans [docs/PLAN.md](docs/PLAN.md#limites-techniques).
