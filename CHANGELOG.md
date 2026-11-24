# Changelog — All Access

## 0.6.18 — 30 juillet 2026

### Nouveautés
- **HDR en un clic — sous-appli dédiée** : le HDR de Windows a désormais sa propre entrée « HDR » dans la barre latérale (section Widget, juste sous « Overlay »). Une page dédiée affiche l'état en grand et propose deux boutons **Activer / Désactiver** — parfait pour allumer le HDR avant un jeu compatible puis le recouper ensuite. Agit sur tous les écrans HDR-compatibles sans droits admin ni passage par les Réglages Windows. La bascule qui vivait auparavant en bas de la page « Overlay » a été déplacée ici.

## 0.6.10 — 18 juillet 2026

### Corrections
- **« Ta bibliothèque est vide », comptes affichés « Non connecté », version invisible** : quand l'icône système (tray) échouait à se créer — observé spécifiquement en lançant l'appli via le raccourci du Bureau plutôt qu'un terminal — TOUS les échanges avec l'interface s'arrêtaient net, puisqu'ils s'initialisaient juste après le tray dans la séquence de démarrage. Ces échanges s'initialisent désormais en tout premier, avant le tray et les autres étapes secondaires (overlay, autostart, surveillance des jeux), chacune isolée pour qu'un échec ponctuel ne bloque plus jamais le reste.

## 0.6.9 — 16 juillet 2026

### Corrections
- **Nom du jeu encore coupé sur « galère depuis X min sur… »** : la limite à 2 lignes ne suffisait pas pour les titres très longs. Le texte s'affiche désormais en entier, sans aucune limite de lignes.

## 0.6.8 — 16 juillet 2026

### Corrections
- **Nom du jeu coupé dans « galère depuis X min sur… »** (onglet Amis) : le statut passait sur une seule ligne tronquée par « … » pour les jeux à titre long. Il s'affiche désormais sur 2 lignes, avec le texte complet en infobulle au survol.

## 0.6.7 — 16 juillet 2026

### Nouveautés
- **Section « 🔥 Promos »** dans Catalogue → Game Pass : les offres du moment sur le Store Xbox (~100 jeux, mêmes promos que la page « Offres sur les jeux » de xbox.com), avec % de remise, prix barré et plateformes (PC/Console). Clic → fiche du jeu sur xbox.com.

### Corrections
- **Promos Steam qui restaient « indisponibles » pendant des heures** : un échec réseau transitoire au premier chargement était mis en cache 3 h comme s'il s'agissait d'une vraie réponse — et l'appli étant résidente, seul un vrai redémarrage le purgeait. Un résultat vide n'est plus jamais mis en cache (Steam comme Xbox) : la prochaine visite de la page retente immédiatement.

## 0.6.6 — 16 juillet 2026

### Nouveautés
- **Page Overlay** : cliquer sur Widget → Overlay ouvre désormais une page dédiée (présentation du mini-moniteur CPU/GPU/RAM/FPS) qui propose d'**installer** l'overlay sur ce PC (copie dans `%LOCALAPPDATA%\Programs\HW Monitor` + raccourci bureau « HW Monitor ») puis de le lancer. L'overlay installé reste utilisable sans ouvrir All Access.

## 0.6.5 — 16 juillet 2026

### Fiabilité des succès
- **Notification Windows native en plus de la bannière** : en plein écran exclusif, Windows n'affiche aucune fenêtre par-dessus le jeu — la bannière overlay se jouait dans le vide. Le toast système s'affiche par-dessus la plupart des jeux et reste dans le centre de notifications : un déblocage laisse désormais TOUJOURS une trace.
- **Journal de diagnostic** (`%APPDATA%\gamevault\achievements.log`) : chaque détection de jeu, chaque vérification de succès et chaque erreur y sont tracées — fini les échecs silencieux indiagnosticables.

## 0.6.4 — 16 juillet 2026

### Corrections
- **« Je clique sur le raccourci et rien ne se passe »** : réouverture fiabilisée quand l'appli tourne déjà en résident — restauration si minimisée, recréation si la fenêtre a disparu, passage forcé au premier plan, et clignotement dans la barre des tâches si un jeu garde le focus (seul signal possible en plein écran exclusif).
- **Icône du tray** : un simple clic rouvre désormais la fenêtre (le double-clic marchait seul, personne ne le devine).

## 0.6.3 — 16 juillet 2026

### Nouveautés
- **Section « 🆓 Gratuits »** dans Catalogue → Steam : liste des vrais jeux free-to-play (Fortnite, Dota 2, CS2…), distincte des promos temporaires à 100%.

## 0.6.2 — 16 juillet 2026

### Nouveautés
- **Widget « Quoi jouer ce soir ? »** sur le Dashboard : pioche un jeu installé et non terminé dans ta bibliothèque, avec un bouton 🎲 Relancer pour retirer.
- **« Galère depuis X sur [jeu] »** dans l'onglet Amis : pour chaque ami en train de jouer, affiche depuis combien de temps il y est (estimé localement, persiste entre deux lancements d'All Access).

## 0.6.1 — 16 juillet 2026

### Design
- **Refonte des 6 premiers thèmes** (identifiants conservés, thème sauvegardé intact) :
  - Nébuleuse → **Ultraviolet** (violet électrique → fuchsia néon)
  - Rubis → **Carmin** (rouge sang néon + or champagne)
  - Émeraude → **Hologramme** (menthe iridescente + rose holo)
  - Minuit → **Saphir** (bleu électrique + cyan pur)
  - Crépuscule → **Éclipse** (orange solaire → magenta incandescent)
  - Or noir → **Midas** (or 24 carats sur noir pur)

## 0.6.0 — 16 juillet 2026

### Nouveautés
- **Section Widget** dans la barre latérale (extensible), avec **Performance** : lance l'overlay matériel HwMonitor (CPU/GPU/RAM/FPS), désormais embarqué dans l'application.
- **Jauge d'espace disque** dans l'en-tête de la Bibliothèque : Go pris / Go libres par lecteur, rafraîchie toutes les 60 s, alerte rouge sous 25 Go.
- **Cartes « Voir plus »** à la fin des grilles du Catalogue : ouvrent directement l'appli Xbox (Game Pass) ou le client Steam (magasin / promos).
- **Bouton ⟳ Actualiser** dans l'onglet Amis.
- **Logo JD Designer cliquable** (pied de la barre latérale) → ouvre le site du designer.

### Corrections
- **Amis Xbox qui disparaissaient après ~1 h** : le jeton Xbox est maintenant régénéré automatiquement (retry sur 401), et la liste conserve les derniers amis connus si un rafraîchissement échoue.
- **Thème et notifications qui ne persistaient pas** entre deux lancements : sauvegarde fiabilisée (état frais systématique, écriture disque blindée).

### Performance et robustesse
- Cartes de jeu mémoïsées + rendu ignoré hors écran (`content-visibility`) : grosses bibliothèques fluides.
- Recherche non bloquante (`useDeferredValue`).
- Garde-fou global (ErrorBoundary) : plus d'écran noir en cas d'erreur d'interface, fallback avec bouton Recharger.
- Respect du réglage système « animations réduites » (framer-motion + fond animé figé en image statique).

## 0.5.5 et antérieures
Versions initiales : bibliothèque Steam/Xbox/Epic/Ubisoft/Rockstar, succès et notifications animées, catalogue Game Pass et promos Steam, amis, dashboard, thèmes et fonds animés, overlay de succès.
