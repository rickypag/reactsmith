# Apollo clone: setup

A trial run of ReactSmith: a copy of the [Apollo Client docs](https://www.apollographql.com/docs/react), built with the CLI as it is today. These commands set up the structure, the top bar and the sidebar. Page content comes later.

The commands are written for **PowerShell**. In Git Bash, the variable lines change (`$T = ...` becomes `T=...`), and Git Bash rewrites arguments that start with `/` into Windows paths (`--path "/"` turns into `C:/Program Files/Git/`): run `export MSYS_NO_PATHCONV=1` first.

## How the site maps onto the structure

- **One feature per sidebar section**, mounted at the section's URL segment, for example Core concepts → `core-concepts` at `/data`.
- **One view per page**, at the page's path inside its section, for example Queries → `QueriesView` at `/data/queries`.
- The URLs match Apollo's, without the `/docs/react` prefix.
- The API Reference has four groups, each with its own URL prefix, so each group is its own feature: `api-core`, `api-errors`, `api-react` and `api-link`.
- The intro pages (Introduction, Why Apollo, Get started…) live at the root, so they form the `overview` feature, mounted at the root with `--path "/"`. Only one feature can be mounted there.
- The sidebar navigation is app data: [setup/navigation.json](setup/navigation.json) becomes the `NAVIGATION` constant in `src/app/constants.ts`, repeated as sections and links.

## 0. Vite starter (done)

Already created in `apps/apollo-clone` with:

```powershell
# from apps/
npx create-vite@9.3.1 apollo-clone --template react-ts --no-interactive --no-immediate
```

## 1. Dependencies (done)

```powershell
# from the repo root
npm pkg set devDependencies.reactsmith="*" scripts.check="reactsmith check" -w apollo-clone
npm install react-router lucide-react -w apollo-clone
npm run build
cd apps/apollo-clone
```

`reactsmith: "*"` resolves to the workspace package, and `npm run build` compiles its CLI.

## 2. Build the site

Run from `apps/apollo-clone`. The whole block can be pasted at once. Each command prints ✔ or ✖, so scroll back for any ✖: PowerShell goes on after a failed command.

```powershell
# --- Init: config, App files, router, global styles (replaces the Vite starter)
npx reactsmith init --yes

# --- Root layout with top bar and sidebar, and Apollo-like colors
npx reactsmith layout create --topbar --sidebar
npx reactsmith style palette --primary "#3f20ba" --neutral "#64748b"

# --- Overview (/)
npx reactsmith feature create overview --path "/"
npx reactsmith view create Introduction --feature overview --index
npx reactsmith view create WhyApollo --feature overview --path why-apollo
npx reactsmith view create GetStarted --feature overview --path get-started
npx reactsmith view create ApolloClient4Migration --feature overview --path migrating/apollo-client-4-migration
npx reactsmith view create VersioningPolicy --feature overview --path versioning-policy

# --- Core concepts (/data)
npx reactsmith feature create core-concepts --path data
npx reactsmith view create Queries --feature core-concepts --path queries
npx reactsmith view create Suspense --feature core-concepts --path suspense
npx reactsmith view create Fragments --feature core-concepts --path fragments
npx reactsmith view create Mutations --feature core-concepts --path mutations
npx reactsmith view create TypeScript --feature core-concepts --path typescript
npx reactsmith view create Refetching --feature core-concepts --path refetching
npx reactsmith view create CustomScalars --feature core-concepts --path custom-scalars
npx reactsmith view create EventBasedRefetching --feature core-concepts --path event-based-refetching
npx reactsmith view create Subscriptions --feature core-concepts --path subscriptions
npx reactsmith view create Directives --feature core-concepts --path directives
npx reactsmith view create ErrorHandling --feature core-concepts --path error-handling
npx reactsmith view create PersistedQueries --feature core-concepts --path persisted-queries
npx reactsmith view create DocumentTransforms --feature core-concepts --path document-transforms
npx reactsmith view create Defer --feature core-concepts --path defer
npx reactsmith view create OperationBestPractices --feature core-concepts --path operation-best-practices

# --- Caching (/caching)
npx reactsmith feature create caching --path caching
npx reactsmith view create Overview --feature caching --path overview
npx reactsmith view create CacheConfiguration --feature caching --path cache-configuration
npx reactsmith view create CacheInteraction --feature caching --path cache-interaction
npx reactsmith view create GarbageCollection --feature caching --path garbage-collection
npx reactsmith view create CacheFieldBehavior --feature caching --path cache-field-behavior
npx reactsmith view create MemoryManagement --feature caching --path memory-management
npx reactsmith view create AdvancedTopics --feature caching --path advanced-topics

# --- Pagination (/pagination)
npx reactsmith feature create pagination --path pagination
npx reactsmith view create Overview --feature pagination --path overview
npx reactsmith view create CoreApi --feature pagination --path core-api
npx reactsmith view create OffsetBased --feature pagination --path offset-based
npx reactsmith view create CursorBased --feature pagination --path cursor-based
npx reactsmith view create KeyArgs --feature pagination --path key-args

# --- Local state (/local-state)
npx reactsmith feature create local-state --path local-state
npx reactsmith view create LocalStateManagement --feature local-state --path local-state-management
npx reactsmith view create FieldPolicies --feature local-state --path managing-state-with-field-policies
npx reactsmith view create ReactiveVariables --feature local-state --path reactive-variables
npx reactsmith view create LocalResolvers --feature local-state --path local-resolvers

# --- Development & testing (/development-testing)
npx reactsmith feature create development-testing --path development-testing
npx reactsmith view create DeveloperTooling --feature development-testing --path developer-tooling
npx reactsmith view create GraphqlCodegen --feature development-testing --path graphql-codegen
npx reactsmith view create Testing --feature development-testing --path testing
npx reactsmith view create SchemaDrivenTesting --feature development-testing --path schema-driven-testing
npx reactsmith view create ClientSchemaMocking --feature development-testing --path client-schema-mocking
npx reactsmith view create ReducingBundleSize --feature development-testing --path reducing-bundle-size

# --- Performance (/performance)
npx reactsmith feature create performance --path performance
npx reactsmith view create Performance --feature performance --path performance
npx reactsmith view create OptimisticUi --feature performance --path optimistic-ui
npx reactsmith view create ServerSideRendering --feature performance --path server-side-rendering
npx reactsmith view create Babel --feature performance --path babel

# --- Integrations (/integrations)
npx reactsmith feature create integrations --path integrations
npx reactsmith view create Integrations --feature integrations --path integrations
npx reactsmith view create NextJs --feature integrations --path nextjs
npx reactsmith view create ReactRouter --feature integrations --path react-router
npx reactsmith view create TanstackStart --feature integrations --path tanstack-start
npx reactsmith view create ReactNative --feature integrations --path react-native
npx reactsmith view create Webpack --feature integrations --path webpack

# --- Networking (/networking)
npx reactsmith feature create networking --path networking
npx reactsmith view create BasicHttpNetworking --feature networking --path basic-http-networking
npx reactsmith view create AdvancedHttpNetworking --feature networking --path advanced-http-networking
npx reactsmith view create Authentication --feature networking --path authentication

# --- API reference: core (/api)
npx reactsmith feature create api-core --path api
npx reactsmith view create ApolloClient --feature api-core --path core/ApolloClient
npx reactsmith view create InMemoryCache --feature api-core --path cache/InMemoryCache
npx reactsmith view create ObservableQuery --feature api-core --path core/ObservableQuery

# --- API reference: errors (/api/errors)
npx reactsmith feature create api-errors --path api/errors
npx reactsmith view create CombinedGraphQLErrors --feature api-errors --path CombinedGraphQLErrors
npx reactsmith view create CombinedProtocolErrors --feature api-errors --path CombinedProtocolErrors
npx reactsmith view create LinkError --feature api-errors --path LinkError
npx reactsmith view create LocalStateError --feature api-errors --path LocalStateError
npx reactsmith view create ServerError --feature api-errors --path ServerError
npx reactsmith view create ServerParseError --feature api-errors --path ServerParseError
npx reactsmith view create UnconventionalError --feature api-errors --path UnconventionalError

# --- API reference: React (/api/react)
npx reactsmith feature create api-react --path api/react
npx reactsmith view create ApolloProvider --feature api-react --path ApolloProvider
npx reactsmith view create UseQuery --feature api-react --path useQuery
npx reactsmith view create UseLazyQuery --feature api-react --path useLazyQuery
npx reactsmith view create UseMutation --feature api-react --path useMutation
npx reactsmith view create UseSubscription --feature api-react --path useSubscription
npx reactsmith view create UseFragment --feature api-react --path useFragment
npx reactsmith view create UseApolloClient --feature api-react --path useApolloClient
npx reactsmith view create UseReactiveVar --feature api-react --path useReactiveVar
npx reactsmith view create UseSuspenseQuery --feature api-react --path useSuspenseQuery
npx reactsmith view create UseBackgroundQuery --feature api-react --path useBackgroundQuery
npx reactsmith view create UseReadQuery --feature api-react --path useReadQuery
npx reactsmith view create UseLoadableQuery --feature api-react --path useLoadableQuery
npx reactsmith view create UseQueryRefHandlers --feature api-react --path useQueryRefHandlers
npx reactsmith view create SkipToken --feature api-react --path skipToken
npx reactsmith view create Preloading --feature api-react --path preloading
npx reactsmith view create Testing --feature api-react --path testing
npx reactsmith view create Ssr --feature api-react --path ssr

# --- API reference: Apollo Link (/api/link)
npx reactsmith feature create api-link --path api/link
npx reactsmith view create Introduction --feature api-link --path introduction
npx reactsmith view create ApolloLink --feature api-link --path apollo-link
npx reactsmith view create BaseHttpLink --feature api-link --path apollo-link-base-http
npx reactsmith view create BaseBatchHttpLink --feature api-link --path apollo-link-base-batch-http
npx reactsmith view create BatchHttpLink --feature api-link --path apollo-link-batch-http
npx reactsmith view create BatchLink --feature api-link --path apollo-link-batch
npx reactsmith view create ClientAwarenessLink --feature api-link --path apollo-link-client-awareness
npx reactsmith view create ErrorLink --feature api-link --path apollo-link-error
npx reactsmith view create GraphQLWsLink --feature api-link --path apollo-link-subscriptions
npx reactsmith view create HttpLink --feature api-link --path apollo-link-http
npx reactsmith view create PersistedQueryLink --feature api-link --path apollo-link-persisted-queries
npx reactsmith view create RemoveTypenameLink --feature api-link --path apollo-link-remove-typename
npx reactsmith view create RetryLink --feature api-link --path apollo-link-retry
npx reactsmith view create SchemaLink --feature api-link --path apollo-link-schema
npx reactsmith view create SetContextLink --feature api-link --path apollo-link-context
npx reactsmith view create WebSocketLink --feature api-link --path apollo-link-ws
npx reactsmith view create CommunityLinks --feature api-link --path community-links

# --- Top bar: logo, badge and menus on the left; search, theme toggle and Sign In on the right
$T = "app/components/TopBar/TopBar.tsx"
npx reactsmith style update "$T#root" --padding "0 6"
npx reactsmith element insert div --into "$T#root" --name start --direction row --align center --gap 8
npx reactsmith element insert div --into "$T#root" --name end --direction row --align center --gap 2
npx reactsmith element insert NavLink --into "$T#start" --props "to='/'" --name brand
npx reactsmith element insert span --into "$T#brand" --text "APOLLO" --name logo
npx reactsmith element insert span --into "$T#brand" --text "DOCS" --name badge
npx reactsmith element insert nav --into "$T#start" --name menus --direction row --align center --gap 6
npx reactsmith component create NavMenu --app --root button --text "{label}" --interface "label: string"
npx reactsmith element insert ChevronDownIcon --into "app/components/NavMenu/NavMenu.tsx#root" --props "size={16}"
npx reactsmith element insert NavMenu --into "$T#menus" --props "label='Products'"
npx reactsmith element insert NavMenu --into "$T#menus" --props "label='Open source'"
npx reactsmith element insert NavLink --into "$T#menus" --text "Resources" --props "to='/resources'" --name link
npx reactsmith element insert button --into "$T#end" --text "Search Apollo content (Cmd+K or /)" --name search
npx reactsmith element insert SearchIcon --into "$T#search" --position first --props "size={18}"
npx reactsmith element insert button --into "$T#end" --name theme
npx reactsmith element insert MoonIcon --into "$T#theme" --props "size={18}"
npx reactsmith element insert button --into "$T#end" --text "Sign In" --name signIn

# --- Top bar styles
npx reactsmith style update "$T#brand" --css "display: flex; align-items: center; gap: var(--space-2); color: var(--color-text); text-decoration: none"
npx reactsmith style update "$T#logo" --css "font-size: 1.5rem; font-weight: 600; letter-spacing: 0.12em"
npx reactsmith style update "$T#badge" --css "padding: var(--space-1) var(--space-3); border: 1px solid var(--color-text); font-size: 0.875rem; font-weight: 500; letter-spacing: 0.1em"
npx reactsmith style update "app/components/NavMenu/NavMenu.tsx#root" --css "display: inline-flex; align-items: center; gap: var(--space-1); padding: 0; border: none; background: none; font: inherit; font-size: 1.125rem; color: var(--color-text-muted); cursor: pointer"
npx reactsmith style update "app/components/NavMenu/NavMenu.tsx#root" --state hover --css "color: var(--color-text)"
npx reactsmith style update "$T#link" --css "font-size: 1.125rem; color: var(--color-text-muted); text-decoration: none"
npx reactsmith style update "$T#link" --state hover --css "color: var(--color-text)"
npx reactsmith style update "$T#search" --css "display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius); background: none; font: inherit; color: var(--color-text-muted); cursor: pointer"
npx reactsmith style update "$T#search" --state hover --css "border-color: var(--color-text-muted)"
npx reactsmith style update "$T#theme" --css "display: inline-flex; padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: none; color: var(--color-text); cursor: pointer"
npx reactsmith style update "$T#signIn" --css "padding: var(--space-2) var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius); background: none; font: inherit; color: var(--color-text); cursor: pointer"

# --- Sidebar: NAVIGATION (app data) repeated as sections, each repeating its links
npx reactsmith constant create NAVIGATION --app --file setup/navigation.json
npx reactsmith component create SidebarLink --app --root NavLink --text "{label}" --interface "label: string; href: string" --root-props "to={href}"
npx reactsmith component create SidebarSection --app --interface "title: string; pages: { label: string; href: string }[]" --gap 1
npx reactsmith element insert h2 --into "app/components/SidebarSection/SidebarSection.tsx#root" --text "{title}" --name title
npx reactsmith element insert SidebarLink --into "app/components/SidebarSection/SidebarSection.tsx#root" --each pages --as page --key page.href --props "{...page}"
npx reactsmith element insert SidebarSection --into "app/components/Sidebar/Sidebar.tsx#root" --each NAVIGATION --as section --key section.title --props "{...section}"

# --- Sidebar styles: the link of the open page is highlighted (the "current" state)
npx reactsmith style update "app/components/Sidebar/Sidebar.tsx#root" --gap 6 --padding "6 4"
npx reactsmith style update "app/components/SidebarSection/SidebarSection.tsx#title" --css "margin: 0 0 var(--space-1); font-size: 0.875rem; font-weight: 600; color: var(--color-text)"
npx reactsmith style update "app/components/SidebarLink/SidebarLink.tsx#root" --css "padding: var(--space-1) var(--space-2); border-radius: var(--radius); font-size: 0.9375rem; color: var(--color-text-muted); text-decoration: none"
npx reactsmith style update "app/components/SidebarLink/SidebarLink.tsx#root" --state hover --css "background: var(--color-primary-subtle); color: var(--color-text)"
npx reactsmith style update "app/components/SidebarLink/SidebarLink.tsx#root" --state current --css "background: var(--color-primary-subtle); color: var(--color-primary); font-weight: 600"

# --- Verify
npx reactsmith check
npx tsc -b
```

Then run `npm run dev` and try `/`, `/data/queries`, `/api/react/useQuery` and an unknown path for the not-found view.

## 3. Reset to the fresh Vite starter

Removes everything the setup generated and restores the starter files that `init` changed (`src/`, `tsconfig.app.json`, `vite.config.ts`), so step 2 can be run again. The installed packages (`package.json`, `node_modules`) and this guide stay. Run from `apps/apollo-clone`; the whole block can be pasted at once.

```powershell
# --- Remove what the setup generated
Remove-Item -Recurse -Force src, dist, reactsmith.config.json -ErrorAction SilentlyContinue

# --- Get the starter files from a fresh copy of the template, in a temporary folder
$here = Get-Location
$tmp = Join-Path $env:TEMP "apollo-clone-reset"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Set-Location $env:TEMP
npx create-vite@9.3.1 apollo-clone-reset --template react-ts --no-interactive --no-immediate
Set-Location $here

# --- Put them back, then delete the temporary folder
Copy-Item -Recurse "$tmp\src" .
Copy-Item "$tmp\tsconfig.app.json", "$tmp\vite.config.ts" .
Remove-Item -Recurse -Force $tmp
```

## Notes

- **Inserting**: `element insert <name> --into <target>` inserts an HTML tag or any component. A component is imported from where it is found: a component of the project (`NavMenu`) or a package (`NavLink` from react-router); `--from` picks the source when several have the name. Its props, given with `--props`, are checked: against the component's interface, or against TypeScript's types for HTML tags and packages.
- **Links inside the app** are React Router's `NavLink`, so clicking one doesn't reload the page. A `NavLink` holds text and other elements (the logo and the badge), and marks the open page with `aria-current="page"`, styled with `--state current`.
- **Ids** use the element's name, the one given with `--name` (its style uses it): `$T#signIn` is the Sign In button, whatever is inserted around it. A component's root is `root`. Elements without a name have a path, counting from 1 among siblings with the same tag (`header/div[2]/button[3]`), which shifts when siblings are inserted: give an element a name to address it reliably. Check an id with `npx reactsmith id src/app/components/TopBar/TopBar.tsx:<line>`. A list's id is its variable: `app/components/Sidebar/Sidebar.tsx#root/{NAVIGATION}`.
- **Variables**: `--text "{label}"` shows the `label` prop, and ReactSmith destructures it. A name that isn't a prop is looked up in the constants files the file can use (its own, its feature's, the app's) and imported, as `NAVIGATION` is in `Sidebar.tsx`.
- **Lists**: `element insert SidebarSection --each NAVIGATION --as section --key section.title` writes `{NAVIGATION.map((section) => <SidebarSection key={section.title} {...section} />)}`. Lists only repeat components; any logic goes into a constant or the component.
- **Changing the navigation**: edit [setup/navigation.json](setup/navigation.json) and run `npx reactsmith constant update NAVIGATION --app --file setup/navigation.json`.

**Not possible yet:**
- The logo is the word APOLLO. An `<img>` could be inserted now (`element insert img --props "src='/logo.svg' alt='Apollo'"`), but the clone has no logo file.
- The dropdown panels, the orange "Open source" (the active menu), the theme toggle's behavior and the search dialog: they need state.
- Page content: Apollo serves every page as Markdown (append `.md` to a docs URL), so a view could render it. And the "On this page" table of contents on the right.
