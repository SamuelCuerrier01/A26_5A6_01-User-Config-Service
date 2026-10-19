# AGENTS.md — Chatvardage User Config Service

Règles de travail pour toute personne ou tout agent qui modifie ce dépôt.

## Contexte du projet

Ce dépôt est le **User-Config-Service** de Chatvardage.

Architecture d'équipe :

- `Frontend` : client Electron.
- `Mobile` : application Expo (React Native).
- `Serveur-API` : API Gateway / point d'entrée unique.
- `Authentification` : utilisateurs, authentification et rôles.
- `Room-Service` : serveurs, membres, rôles et salons.
- `Message-Service` : messages privés et de salon, historique et temps réel.
- `User-Config-Service` : alias, thème, langue, présence et préférences de notification. **Ce dépôt.**
- `Dashboard` : panneau d'administration / AdminJS.
- `Infra` : Docker Compose, PostgreSQL, Redis et orchestration globale.

Le User-Config-Service ne doit **pas** prendre en charge l'authentification, les salons, les messages ou le temps réel. Il persiste uniquement les préférences propres à chaque utilisateur.

## Stack

- Node.js 22
- NestJS 11
- TypeScript
- Prisma 6
- PostgreSQL 17
- Jest
- ESLint + Prettier
- Swagger / OpenAPI
- Docker / Docker Compose

## Responsabilités du User-Config-Service

Le service doit conserver la responsabilité de :

- lire la configuration d'un utilisateur (créée avec des valeurs par défaut si elle n'existe pas encore);
- mettre à jour l'alias, le thème, la langue, le mode de notification et l'avatar;
- définir le statut de présence (`enLigne` / `horsLigne`) et l'horodatage de dernière activité;
- persister ces préférences dans PostgreSQL, une ligne par utilisateur;
- exposer un healthcheck pour le service et PostgreSQL.

Ne pas déplacer ici les responsabilités des autres microservices. En particulier, ne pas gérer le pseudo/l'identité (propriété d'`Authentification`), ni les salons ou messages.

## Contrat avec le Gateway

Le service est destiné à être appelé derrière `Serveur-API`.

Le Gateway transmet l'identité déjà validée avec :

```http
x-internal-token: <INTERNAL_SERVICE_TOKEN>
x-user-id: <id utilisateur>
```

`InternalTokenGuard` (`src/internal/`) protège toutes les routes sauf `/api/health` : `x-user-id` n'est cru qu'avec le bon jeton interne. Ne jamais retirer ce garde d'une route qui lit `x-user-id`. Dans l'architecture finale, le User-Config-Service doit en plus rester un service interne.

Authentification appelle `DELETE /api/internal/users/:userId` (même jeton) après la suppression d'un compte.

Toutes les routes sont sous `/api`. Swagger est exposé sous `/docs`.

## Contrat de données avec le Frontend

Le format retourné par l'API doit rester stable, sauf changement coordonné entre les dépôts :

```ts
{
  type: 'configUtilisateur',
  idUtilisateur: string,
  alias: string | null,
  theme: 'sombre' | 'clair',
  langue: 'fr' | 'en',
  statutPresence: 'enLigne' | 'horsLigne',
  vuLaDerniereFois: string | null,
  modeNotification: 'systeme' | 'discret' | 'aucune',
  avatar: string | null // data URL base64 PNG/JPEG/WebP, ou null
}
```

Le Frontend consomme ce format via le Gateway : `main.js` charge la configuration à l'ouverture de session et y enregistre chaque changement (thème et langue depuis la page profil, langue choisie sur l'écran de connexion/inscription, présence, mode de notification). Tout changement de ce format doit être coordonné avec le Frontend.

Les `idUtilisateur` restent des chaînes. Ne pas ajouter de table `User` ou de clé étrangère vers un utilisateur : les utilisateurs appartiennent au service d'authentification.

## Décisions de conception à préserver

### `vuLaDerniereFois` mis à jour même en passant `horsLigne`

Dans `ConfigUtilisateurService.definirPresence`, `vuLaDerniereFois` est réécrit à **chaque** appel, peu importe le `statut` fourni (`enLigne` ou `horsLigne`). Ceci est volontaire, pas un oubli :

- Ce champ représente « vu(e) pour la dernière fois », affiché côté Frontend uniquement quand `statutPresence` est `horsLigne` (convention WhatsApp/Messenger/Telegram).
- Il doit donc correspondre à l'instant de la **déconnexion**, pas à celui de la dernière connexion.
- Une correction qui ne mettrait à jour ce champ qu'en passant `enLigne` semble intuitive à première vue, mais casserait cette sémantique : un utilisateur resté connecté 3 heures puis déconnecté afficherait alors « vu(e) il y a 3 heures » juste après s'être déconnecté.

Ne pas « corriger » ce comportement sans revalider l'intention produit avec l'équipe.

### Migration Prisma exécutée dans le `CMD` du conteneur (pas d'init container séparé)

Le `Dockerfile` lance `./node_modules/.bin/prisma migrate deploy && exec node dist/main` directement dans le `CMD` du service applicatif. npm/npx sont retirés de l'image finale; le CLI Prisma reste installé comme dépendance de production, dans la version figée par le lockfile. Les migrations ne sont pas déléguées à un init container ou un job séparé (pattern recommandé en production multi-replica, pour éviter que plusieurs instances tentent d'appliquer les mêmes migrations en parallèle au démarrage).

Ce choix est volontaire pour ce dépôt :

- L'environnement cible est **mono-replica** (`docker-compose.yml` d'Infra), donc le risque de concurrence entre plusieurs instances au démarrage ne s'applique pas.
- Room-Service et Message-Service utilisent tous les deux exactement le même pattern. Changer uniquement User-Config-Service introduirait une incohérence de déploiement entre les trois services sans bénéfice réel dans ce contexte.

Si le projet évolue vers un déploiement multi-replica (production réelle, Kubernetes, etc.), ce pattern devrait être revu **sur les trois services en même temps**, pas isolément sur celui-ci.

### `recupererOuCreer` et la suppression d'un compte

Après un conflit de création concurrente (`P2002`), `recupererOuCreer` relit la ligne avec `findUnique`. Depuis la route interne de suppression de compte, cette ligne peut avoir disparu entre-temps : la méthode renvoie alors 409 plutôt qu'une erreur 500.

### Validation de `alias`/`theme`/`langue`/`modeNotification` : à la frontière (DTO) seulement, pas dans le service

`ConfigUtilisateurService.mettreAJour` fait `dto.alias.trim()` sans revérifier que `dto.alias` n'est pas `null`, alors que rien n'empêche *syntaxiquement* TypeScript de laisser passer `null` (le type `alias?: string` n'est pas vérifié à l'exécution). Ceci est volontaire, pas un oubli :

- Le seul appelant réel de `mettreAJour` est `ConfigUtilisateurController`, qui reçoit un DTO déjà passé par le `ValidationPipe` global. Le DTO utilise `@ValidateIf((o) => o.alias !== undefined)` pour rejeter explicitement `alias: null` en 400 **avant** d'atteindre le service (voir `mettre-a-jour-config.dto.ts` et `mettre-a-jour-config.dto.spec.ts`).
- Dupliquer une garde `dto.alias == null` dans le service reviendrait à maintenir la même règle à deux endroits pour un cas qui ne peut pas se produire via le système réel aujourd'hui.
- Ce serait aussi incohérent avec `theme`, `langue`, `modeNotification` (DTO) et `statut` (présence), qui reposent tous uniquement sur cette même frontière sans garde supplémentaire côté service — traiter `alias` différemment serait arbitraire.

Ne pas ajouter cette garde « au cas où » côté service. Si un futur appelant interne (job, autre service, script de seed) doit appeler `mettreAJour` sans passer par le `ValidationPipe` HTTP, il doit construire un `MettreAJourConfigDto` valide (ou passer par `class-validator` lui-même), pas contourner la validation.

### Identifiants de développement en clair dans `compose.local.yml`

`compose.local.yml` contient `POSTGRES_PASSWORD: chatvardage` en clair, versionné dans le dépôt. C'est volontaire, pas une fuite de secret :

- Ce PostgreSQL est **jetable** : il n'existe que dans un conteneur local, lié uniquement à `localhost`, recréé/détruit à volonté (`docker compose down -v`).
- Ces identifiants ne protègent rien de sensible et ne sont réutilisés nulle part ailleurs (l'environnement d'équipe via `Infra` utilise ses propres identifiants distincts, non versionnés dans ce dépôt).
- Room-Service utilise exactement le même pattern dans son propre `compose.local.yml`.

Ne pas déplacer ça vers un `.env.local` : ça ajouterait de la friction pour du développement local sans protéger un vrai secret. Ce raisonnement ne s'applique **pas** à un secret réel (`JWT_SECRET`, mot de passe de l'environnement `Infra`, etc.) : ceux-là ne doivent jamais être versionnés.

### `CORS_ORIGINS` n'est pas validé au démarrage

`src/main.ts` découpe `process.env.CORS_ORIGINS` sur les virgules sans vérifier que chaque valeur est une URL bien formée. C'est volontaire :

- `CORS_ORIGINS` est une variable de configuration posée par la personne qui déploie le service (via `Infra`/`docker-compose`), pas une entrée utilisateur ou attaquant — même niveau de confiance que `DATABASE_URL` ou `PORT`.
- Une origine mal formée échoue déjà de façon sûre : le navigateur ne fera simplement jamais correspondre son en-tête `Origin` à une valeur invalide, donc le CORS reste fermé (pas de trou de sécurité).
- Une validation stricte de type "doit être une URL" rejetterait aussi `*` (joker CORS légitime), ce qui casserait un cas d'usage volontaire si l'équipe veut un jour l'utiliser.

Ne pas ajouter de validation de format ici. Si une vraie erreur de config CORS doit être détectée tôt, le faire au niveau du déploiement (`docker compose config`, revue de PR sur `Infra`), pas dans le code applicatif.

### Pas de message d'erreur personnalisé quand un champ est explicitement `null`

Les DTO utilisent les messages par défaut de `class-validator` (ex. `"alias must be a string"`, `"theme must be one of the following values: sombre, clair"`) plutôt qu'un message dédié du type « ce champ ne peut pas être null ». C'est volontaire :

- Ces messages par défaut couvrent déjà correctement **toute** valeur invalide (nombre, objet, `null`, etc.), pas seulement `null` — c'est le comportement standard de validation partout ailleurs dans ce dépôt.
- Créer un message spécifique au cas `null` introduirait un traitement incohérent : pourquoi `null` mériterait un message sur-mesure et pas un `42` ou un `{}` envoyé par erreur ?
- Aucun autre DTO du projet (ici ou dans Room-Service/Message-Service) ne personnalise ses messages de validation.

Ne pas ajouter de décorateur `@IsNotNull()` custom ou de message personnalisé pour ce cas précis sans étendre la même logique à toutes les validations du dépôt.

### Avatar stocké en data URL dans la colonne `avatar`

L'image de profil est une data URL base64 (`data:image/png|jpeg|webp;base64,...`) stockée telle quelle en `TEXT`, plutôt qu'un fichier sur disque ou un stockage objet. C'est volontaire pour ce projet :

- Le Frontend redimensionne l'image à 256 px avant l'envoi (~20-60 Ko), et le DTO borne la valeur à 90 000 caractères : elle tient sous la limite JSON par défaut d'Express (100 Ko) et sous celle du Gateway (`MAX_PROXY_BODY_BYTES`, 1 Mo).
- Aucun volume ni service de stockage supplémentaire à gérer dans `Infra`.
- Le SVG est refusé (il peut contenir du script) : seules les images matricielles passent la validation.

Si les avatars grossissent ou doivent être servis à beaucoup d'utilisateurs, migrer vers un stockage objet avec une URL dans cette colonne.

### Profils publics et présence effective (`actif`)

`GET /api/config-utilisateur/publiques?ids=…` expose à tout utilisateur authentifié un sous-ensemble **public** de la configuration d'autres utilisateurs : `alias`, `avatar`, `statutPresence`, `vuLaDerniereFois` et `actif`. Ne jamais y ajouter de préférence privée (thème, langue, notifications).

- `statutPresence` est le statut **choisi** : il reste `enLigne` si l'app plante ou perd le réseau. `actif` est la présence **effective** : `enLigne` ET `vuLaDerniereFois` datant de moins de `DELAI_PRESENCE_ACTIVE_MS` (90 s). Le Frontend renvoie `PUT /presence` environ toutes les 20 s tant qu'il est connecté, ce qui sert de signe de vie.
- `actif` est calculé ici, et non côté client, pour ne pas dépendre de l'horloge de chaque machine.
- Aucune ligne n'est créée pour les identifiants inconnus : ils sont simplement absents de la réponse.
- 100 identifiants maximum par requête ; `inclureAvatar=false` permet de rafraîchir souvent la présence sans retransférer les images.

## Base de données et Prisma

Schéma principal : `ConfigUtilisateur` (une ligne par utilisateur, clé primaire `idUtilisateur`).

Les migrations Prisma sont versionnées dans `prisma/migrations/`.

Après une modification de `prisma/schema.prisma` :

```bash
npx prisma generate
npx prisma migrate dev --name <nom_de_la_migration>
```

Ne jamais modifier une migration déjà appliquée pour masquer un changement. Créer une nouvelle migration.

Dans l'image Docker finale (sans npm/npx), utiliser :

```bash
./node_modules/.bin/prisma migrate deploy
```

En développement/build, `npx prisma migrate deploy` reste disponible.

## Commandes obligatoires avant de terminer une modification

Installer les dépendances de façon reproductible :

```bash
npm ci
```

Puis exécuter au minimum :

```bash
npm audit --audit-level=high
npm run lint
npm test
npm run test:e2e
npm run build
```

**Audit des dépendances** : le CI lance `npm audit --audit-level=high` (dépendances de dev comprises). Si un avis `high` ou `critical` sans correctif compatible le bloque, forcer une version corrigée par un `overrides` ciblé dans `package.json` si elle existe ; sinon consigner l'exception dans une section « Limites connues » du README, à créer au besoin (paquet, avis, raison, condition de retrait). Ne pas retirer ni affaiblir l'étape.

Pour une modification importante de logique métier, exécuter aussi :

```bash
npm run test:cov
```

Pour vérifier le formatage :

```bash
npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

`npm run format` modifie les fichiers; ne l'utiliser que lorsqu'un formatage automatique est souhaité.

Un agent ne doit pas annoncer que le travail est terminé si une de ces vérifications échoue. Il doit corriger l'erreur ou indiquer clairement ce qui bloque.

## Tests

Framework officiel de ce dépôt : **Jest**.

Lors d'un changement de comportement :

1. ajouter ou modifier les tests concernés;
2. couvrir le chemin nominal;
3. couvrir les cas d'erreur importants (identité manquante, DTO vide, etc.);
4. éviter les tests qui vérifient uniquement `toBeDefined()` lorsqu'un comportement peut être testé;
5. mocker `PrismaService` dans les tests unitaires plutôt que dépendre d'une vraie base de données.

Les tests E2E doivent refléter les routes actuelles du User-Config-Service.

`test/app.e2e-spec.ts` mocke entièrement `PrismaService` (pas de vraie base de données) : c'est délibéré et conforme à la convention officielle de NestJS (le schematic `nest new` génère un fichier `*.e2e-spec.ts` selon exactement ce pattern — pipeline HTTP complète via `supertest`, providers remplacés). Room-Service fait de même. Ne pas renommer ce fichier en `*.integration-spec.ts` uniquement pour ce dépôt : ça introduirait une incohérence de convention avec les autres services sans bénéfice réel.

## Langue du code

Ce dépôt est rédigé **entièrement en français** : identifiants (variables, méthodes, champs Prisma, routes), messages d'erreur et documentation. Seuls les mots-clés du langage/framework (`Controller`, `Service`, `Module`, `class-validator`, etc.) restent en anglais, car ils font partie de NestJS/TypeScript.

## Lint, style et qualité

- Respecter ESLint et Prettier existants.
- Garder TypeScript typé; éviter `any` dans le code de production.
- Garder les contrôleurs minces : validation HTTP/headers et délégation au service.
- Garder la logique métier dans `ConfigUtilisateurService`.
- Garder l'accès aux données via Prisma.
- Valider les entrées avec les DTO et `class-validator`.
- Retourner des erreurs HTTP NestJS explicites (`BadRequestException`, `UnauthorizedException`, etc.).
- Ne pas laisser de code généré, mort ou de dépendances inutilisées.
- Pas de commentaires dans le code : les explications vont dans le README, le guide du service d'Infra ou ce fichier (section « Décisions de conception à préserver »). Seules restent les directives d'outils (`istanbul ignore`).

## Fichiers partagés (`src/partage/`)

`src/partage/secrets-production.ts` (+ spec) est **identique à l'octet près** dans Room-Service et Message-Service : refus de démarrer en production avec les secrets de développement. Ne pas le modifier dans un seul dépôt : reporter le même changement partout, puis lancer `A26_5A6_01-Infra/scripts/verifier-fichiers-partages.sh`. Les secrets exigés par ce service se passent en paramètre depuis `main.ts`.

## Docker

Pour tester ce dépôt seul :

```bash
docker compose -f compose.local.yml up --build
```

Le compose local doit lancer :

- User-Config-Service sur `3005`;
- PostgreSQL;
- les migrations Prisma au démarrage du service.

Healthcheck attendu :

```bash
curl http://localhost:3005/api/health
```

Le `compose.local.yml` sert au développement autonome. L'environnement final est orchestré par le dépôt `Infra`.

Ne pas ajouter Redis ou de WebSocket à ce service : la configuration utilisateur est consultée en REST classique, sans temps réel pour l'instant.

## Documentation

Toute modification d'une route, d'un DTO, d'une variable d'environnement, d'un port ou d'une procédure de lancement doit mettre à jour :

- Swagger/OpenAPI lorsque pertinent;
- `README.md`;
- `.env.example` lorsque pertinent;
- ce fichier `AGENTS.md` si les règles de développement changent.

Le README doit rester suffisant pour démarrer et tester le service sans connaissance implicite du projet.

## Avant une Pull Request

Vérifier :

- [ ] le changement reste dans la responsabilité du User-Config-Service;
- [ ] aucun secret ou `.env` réel n'est commité;
- [ ] les migrations Prisma nécessaires sont présentes;
- [ ] `npm run lint` passe;
- [ ] `npm test` passe;
- [ ] `npm run test:e2e` passe;
- [ ] `npm run build` passe;
- [ ] `npm audit --audit-level=high` passe;
- [ ] `npm run test:cov` a été vérifié pour les changements importants;
- [ ] Swagger et README sont à jour;
- [ ] le compose local fonctionne si Docker/DB ont été modifiés;
- [ ] les changements incompatibles avec Frontend/Serveur-API sont documentés.

Dans la description de PR, résumer les changements, indiquer les tests exécutés et signaler tout impact sur les autres dépôts.

## Couverture obligatoire

- `npm run test:cov` doit terminer avec 100 % Statements, Branches, Functions et Lines.
- Le seuil Jest global est fixé à 100 % : toute baisse fait échouer la commande.
- Toute nouvelle branche de logique doit être accompagnée de tests couvrant succès et erreurs.
- Avant une PR : `npm audit --audit-level=high`, `npm run lint`, `npm test`, `npm run test:cov`, `npm run test:e2e`, `npm run build`.

## Documentation centrale

Infra est la référence du démarrage complet, des architectures, contrats et scénarios de validation. Le README local décrit le dépôt et ses commandes; les guides détaillés sont dans `A26_5A6_01-Infra/docs/`. Toute modification de contrat doit mettre à jour la référence centrale et ses liens.

## Choix délibérés (ne pas « corriger »)

- **CLI Prisma appelé directement** (`node_modules/.bin/prisma`, vérifié au build sous l'utilisateur `appuser`) : npm/npx sont absents de l'image finale.
- **Plage `^4.3.2` de l'`overrides` `js-yaml`** : `npm ci` installe la version exacte du lockfile ; toute régénération passe par l'audit et les tests.
- **Métadonnées libc du lockfile** : elles décrivent des binaires optionnels de compilation ; pas de réécriture manuelle. Toute nouvelle dépendance native impose de reconstruire l'image Alpine et de rejouer les migrations.
- **`apk upgrade` dans l'image** : il applique les correctifs système disponibles ; une image de diffusion est identifiée par son digest et rescannée.
- **`RUN` séparés** entre la suppression privilégiée de npm et le contrôle sans privilège : les fusionner sous root supprimerait cette vérification.
