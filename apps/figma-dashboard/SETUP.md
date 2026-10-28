# Figma dashboard: setup

A trial run of ReactSmith: the main dashboard of the free [Horizon UI](https://www.figma.com/community/file/1098131983383434513) Figma file, built with the CLI as it is today, from the frame's properties read through the Figma API.

The commands are written for **PowerShell**. Windows PowerShell 5.1 drops double quotes inside an argument when it calls `npx`, so props use single quotes (`--props "label='Earnings'"`), and a `$` inside double quotes is escaped with a backtick (`` `$350.4 ``).

## The source

- File `rN54U19ElZDpQzNNAs6qra`, frame "Main Dashboard" (node `201:1804`); the sidebar alone is node `201:2102`.
- Read with a personal access token (Figma → Settings → Security, read-only is enough):

  ```powershell
  curl.exe -H "X-Figma-Token: $env:FIGMA_TOKEN" "https://api.figma.com/v1/files/rN54U19ElZDpQzNNAs6qra/nodes?ids=201:1804"
  ```

  The JSON gives the layer tree, the texts, hidden layers, colors, fonts and, where the file uses auto layout, direction, gap and padding. Horizon uses auto layout only for the page's rows; the sidebar and the cards' insides are positioned absolutely, so their spacing comes from the coordinates.

## How the design maps onto the structure

- **Left out**: the widgets with images (Weekly Revenue, whose chart is a bitmap, and the whole last row: Course, Team, Safety, Cashback), and the charts and calendar (Total Spent, Daily Traffic, Pie Chart, Calendar), which need a chart library or a grid. What remains: the shell, the six stat cards, the two tables and the tasks.
- **Replaced**: the balance card's flag and the avatar photo, by an icon and initials. Horizon's filled icons by the closest lucide icons.
- **One feature per sidebar page**, the dashboard at the root (`/`); the other pages only have their header.
- **The header is part of each page**, not a top bar: Horizon's breadcrumb and title sit in the content area. It is the shared component `PageHeader` (type `layout`), which also holds the toolbar (search, notifications, dark mode, info, avatar).
- **Desktop only**: the sizes are Figma's (1920px wide frame); nothing is responsive.
- **Colors** go through the palette: `--primary #4318FF`, neutral `#A3AED0`. The page uses `--color-surface`, the cards `--color-bg`.
- **Data**: the table rows and the tasks are feature constants from [setup/](setup/) (`CHECK_TABLE`, `COMPLEX_TABLE`, `TASKS`), repeated as lists. The sidebar pages and the stat cards are written one by one, because each has its own icon (see the notes).

## 0. Vite starter (done)

Already created in `apps/figma-dashboard` with:

```powershell
# from apps/
npx create-vite@9.3.1 figma-dashboard --template react-ts --no-interactive --no-immediate
```

## 1. Dependencies (done)

```powershell
# from the repo root
npm pkg set devDependencies.reactsmith="*" scripts.check="reactsmith check" -w figma-dashboard
npm install react-router lucide-react -w figma-dashboard
npm run build
cd apps/figma-dashboard
```

## 2. Build the dashboard

Run from `apps/figma-dashboard`. The whole block can be pasted at once. Each command prints ✔ or ✖, so scroll back for any ✖: PowerShell goes on after a failed command.

```powershell
# --- Init, root layout with a sidebar (the header is part of each page), Horizon colors
npx reactsmith init --yes
npx reactsmith layout create --sidebar
npx reactsmith style palette --primary "#4318FF" --neutral "#A3AED0" --success "#05CD99" --warning "#FFCE20" --danger "#EE5D50"
npx reactsmith style update "app/layouts/RootLayout/RootLayout.tsx#main" --css "padding: 50px 20px 20px; background: var(--color-surface)"

# --- One feature per sidebar page
npx reactsmith feature create dashboard --path "/"
npx reactsmith view create MainDashboard --feature dashboard --index
npx reactsmith feature create marketplace --path nft-marketplace
npx reactsmith view create NftMarketplace --feature marketplace --index
npx reactsmith feature create tables --path data-tables
npx reactsmith view create DataTables --feature tables --index
npx reactsmith feature create kanban --path kanban
npx reactsmith view create Kanban --feature kanban --index
npx reactsmith feature create profile --path profile
npx reactsmith view create Profile --feature profile --index
npx reactsmith feature create auth --path sign-in
npx reactsmith view create SignIn --feature auth --index

# --- Sidebar: brand, the pages, and the PRO card at the bottom
$S = "app/components/Sidebar/Sidebar.tsx"
$N = "app/components/NavItem/NavItem.tsx"
npx reactsmith element insert div --into "$S#root" --name brand
npx reactsmith element insert span --into "$S#brand" --text "HORIZON FREE" --name logo
npx reactsmith element insert nav --into "$S#root" --name pages --gap 5
npx reactsmith component create NavItem --app --root NavLink --interface "label: string; to: string; children?: React.ReactNode" --root-props "to={to}"
npx reactsmith element insert span --into "$N#root" --text "{label}" --name label
npx reactsmith element insert NavItem --into "$S#pages" --props "label='Dashboard' to='/'"
npx reactsmith element insert LayoutDashboardIcon --into "$S#pages/NavItem[1]"
npx reactsmith element insert NavItem --into "$S#pages" --props "label='NFT Marketplace' to='/nft-marketplace'"
npx reactsmith element insert ShoppingCartIcon --into "$S#pages/NavItem[2]"
npx reactsmith element insert NavItem --into "$S#pages" --props "label='Tables' to='/data-tables'"
npx reactsmith element insert ChartColumnIcon --into "$S#pages/NavItem[3]"
npx reactsmith element insert NavItem --into "$S#pages" --props "label='Kanban' to='/kanban'"
npx reactsmith element insert SquareKanbanIcon --into "$S#pages/NavItem[4]"
npx reactsmith element insert NavItem --into "$S#pages" --props "label='Profile' to='/profile'"
npx reactsmith element insert UserIcon --into "$S#pages/NavItem[5]"
npx reactsmith element insert NavItem --into "$S#pages" --props "label='Sign In' to='/sign-in'"
npx reactsmith element insert LockIcon --into "$S#pages/NavItem[6]"

$U = "app/components/UpgradeCard/UpgradeCard.tsx"
npx reactsmith component create UpgradeCard --app --align center --gap 0
npx reactsmith element insert div --into "$U#root" --name badge --align center --justify center
npx reactsmith element insert RocketIcon --into "$U#badge" --props "size={40}"
npx reactsmith element insert span --into "$U#root" --text "Upgrade to PRO" --name title
npx reactsmith element insert p --into "$U#root" --text "to get access to all features! Connect with Venus World!" --name description
npx reactsmith element insert UpgradeCard --into "$S#root"

# --- Sidebar styles: the open page has a bar on the right edge (the "current" state)
npx reactsmith style update "$S#root" --gap none --padding none --css "width: 290px; padding-bottom: 25px; border-right: none; background: var(--color-bg)"
npx reactsmith style update "$S#brand" --css "display: flex; justify-content: center; padding: 56px 0 48px; border-bottom: 1px solid var(--color-surface)"
npx reactsmith style update "$S#logo" --css "font-family: Poppins, var(--font-sans); font-size: 26px; font-weight: 700; line-height: 1; color: var(--color-text)"
npx reactsmith style update "$S#pages" --css "padding: 38px 0 0 33px"
npx reactsmith style update "$N#root" --css "display: flex; align-items: center; gap: 12px; height: 36px; border-right: 4px solid transparent; font-size: 16px; font-weight: 500; letter-spacing: -0.02em; color: var(--color-text-muted); text-decoration: none"
npx reactsmith style update "$N#root" --state hover --css "color: var(--color-text)"
npx reactsmith style update "$N#root" --state current --css "border-right-color: var(--color-primary); font-weight: 700; color: var(--color-primary)"
npx reactsmith style update "$U#root" --css "position: relative; width: 228px; margin: auto auto 0; padding: 72px 0 41px; border-radius: 24px; background: linear-gradient(135deg, #868CFF 0%, var(--color-primary) 100%); color: var(--color-on-primary); text-align: center"
npx reactsmith style update "$U#badge" --gap none --css "position: absolute; top: -48px; left: 50%; translate: -50% 0; width: 94px; height: 94px; border: 5px solid var(--color-bg); border-radius: 50%; background: inherit"
npx reactsmith style update "$U#title" --css "font-size: 16px; font-weight: 700; line-height: 28px; letter-spacing: -0.02em"
npx reactsmith style update "$U#description" --css "margin: 0; font-size: 14px; font-weight: 500; line-height: 24px; letter-spacing: -0.02em; opacity: 0.9"

# --- Page header (shared): breadcrumb and title, and the toolbar with search, actions and avatar
$H = "components/layout/PageHeader/PageHeader.tsx"
npx reactsmith component create PageHeader --type layout --root header --interface "breadcrumb: string; title: string" --direction row --align center --justify between
npx reactsmith element insert div --into "$H#root" --name titles --gap 0
npx reactsmith element insert span --into "$H#titles" --text "{breadcrumb}" --name breadcrumb
npx reactsmith element insert h1 --into "$H#titles" --text "{title}" --name title
npx reactsmith element insert div --into "$H#root" --name toolbar --direction row --align center --gap 5
npx reactsmith element insert div --into "$H#toolbar" --name search --direction row --align center --gap 3 --padding "0 5"
npx reactsmith element insert SearchIcon --into "$H#search" --props "size={14}"
npx reactsmith element insert input --into "$H#search" --props "type='search' placeholder='Search'" --name searchInput
npx reactsmith element insert button --into "$H#toolbar" --props "type='button' aria-label='Notifications'" --name action
npx reactsmith element insert BellIcon --into "$H#toolbar/button[1]" --props "size={20}"
npx reactsmith element insert button --into "$H#toolbar" --props "type='button' aria-label='Dark mode'"
npx reactsmith element insert MoonIcon --into "$H#toolbar/button[2]" --props "size={18}"
npx reactsmith element insert button --into "$H#toolbar" --props "type='button' aria-label='Info'"
npx reactsmith element insert InfoIcon --into "$H#toolbar/button[3]" --props "size={20}"
npx reactsmith element insert span --into "$H#toolbar" --text "AP" --name avatar

# --- Page header styles: the three buttons share the style "action"
npx reactsmith style update "$H#titles" --css "gap: 0"
npx reactsmith style update "$H#breadcrumb" --css "font-size: 14px; font-weight: 500; line-height: 24px; color: var(--color-text-muted)"
npx reactsmith style update "$H#title" --css "margin: 0; font-size: 34px; font-weight: 700; line-height: 42px; letter-spacing: -0.02em; color: var(--color-text)"
npx reactsmith style update "$H#toolbar" --css "padding: 10px; border-radius: 30px; background: var(--color-bg)"
npx reactsmith style update "$H#search" --css "width: 214px; height: 41px; border-radius: 49px; background: var(--color-surface); color: var(--color-text)"
npx reactsmith style update "$H#searchInput" --css "flex: 1; min-width: 0; border: none; outline: none; background: none; font: inherit; font-size: 14px; color: var(--color-text)"
npx reactsmith style update "$H#toolbar/button[1]" --css "display: inline-flex; padding: 0; border: none; background: none; color: var(--color-text-muted); cursor: pointer"
npx reactsmith style update "$H#toolbar/button[1]" --state hover --css "color: var(--color-text)"
npx reactsmith style update "$H#toolbar/button[2]" --name action --css "cursor: pointer"
npx reactsmith style update "$H#toolbar/button[3]" --name action --css "cursor: pointer"
npx reactsmith style update "$H#avatar" --css "display: grid; place-items: center; width: 41px; height: 41px; border-radius: 50%; background: var(--color-primary); color: var(--color-on-primary); font-size: 14px; font-weight: 700"

# --- Every page starts with the header, which holds its title
$V = "features/dashboard/views/MainDashboardView/MainDashboardView.tsx"
npx reactsmith element remove "$V#root/h1"
npx reactsmith element insert PageHeader --into "$V#root" --props "breadcrumb='Pages / Dashboard' title='Main Dashboard'"
npx reactsmith element remove "features/marketplace/views/NftMarketplaceView/NftMarketplaceView.tsx#root/h1"
npx reactsmith element insert PageHeader --into "features/marketplace/views/NftMarketplaceView/NftMarketplaceView.tsx#root" --props "breadcrumb='Pages / NFT Marketplace' title='NFT Marketplace'"
npx reactsmith element remove "features/tables/views/DataTablesView/DataTablesView.tsx#root/h1"
npx reactsmith element insert PageHeader --into "features/tables/views/DataTablesView/DataTablesView.tsx#root" --props "breadcrumb='Pages / Data Tables' title='Data Tables'"
npx reactsmith element remove "features/kanban/views/KanbanView/KanbanView.tsx#root/h1"
npx reactsmith element insert PageHeader --into "features/kanban/views/KanbanView/KanbanView.tsx#root" --props "breadcrumb='Pages / Kanban' title='Kanban'"
npx reactsmith element remove "features/profile/views/ProfileView/ProfileView.tsx#root/h1"
npx reactsmith element insert PageHeader --into "features/profile/views/ProfileView/ProfileView.tsx#root" --props "breadcrumb='Pages / Profile' title='Profile'"
npx reactsmith element remove "features/auth/views/SignInView/SignInView.tsx#root/h1"
npx reactsmith element insert PageHeader --into "features/auth/views/SignInView/SignInView.tsx#root" --props "breadcrumb='Pages / Sign In' title='Sign In'"

# --- Shared parts of the dashboard: a card with a title and a menu button, and a round icon badge
$C = "components/cards/Card/Card.tsx"
npx reactsmith component create Card --type cards --interface "title: string; children?: React.ReactNode" --gap 4 --padding "5 7"
npx reactsmith element insert div --into "$C#root" --position first --name header --direction row --align center --justify between
npx reactsmith element insert h2 --into "$C#header" --text "{title}" --name title
npx reactsmith element insert button --into "$C#header" --props "type='button' aria-label='More'" --name more
npx reactsmith element insert EllipsisIcon --into "$C#more"
npx reactsmith style update "$C#root" --css "border-radius: 20px; background: var(--color-bg)"
npx reactsmith style update "$C#title" --css "margin: 0; font-size: 24px; font-weight: 700; line-height: 32px; letter-spacing: -0.02em; color: var(--color-text)"
npx reactsmith style update "$C#more" --css "display: inline-flex; padding: 6px; border: none; border-radius: 10px; background: var(--color-surface); color: var(--color-primary); cursor: pointer"

$B = "components/badges/IconBadge/IconBadge.tsx"
npx reactsmith component create IconBadge --type badges --interface "children?: React.ReactNode" --align center --justify center
npx reactsmith style update "$B#root" --css "flex-shrink: 0; width: 56px; height: 56px; border-radius: 50%; background: var(--color-surface); color: var(--color-primary)"

# --- Stat cards: an icon badge, a label and a value
$K = "features/dashboard/components/StatCard/StatCard.tsx"
npx reactsmith component create StatCard --feature dashboard --interface "label: string; value: string; children?: React.ReactNode" --direction row --align center --gap 4.5 --padding "5 4"
npx reactsmith element insert div --into "$K#root" --name text --gap 0
npx reactsmith element insert span --into "$K#text" --text "{label}" --name label
npx reactsmith element insert span --into "$K#text" --text "{value}" --name value
npx reactsmith style update "$K#root" --css "flex: 1; border-radius: 20px; background: var(--color-bg)"
npx reactsmith style update "$K#label" --css "font-size: 14px; font-weight: 500; line-height: 24px; letter-spacing: -0.02em; color: var(--color-text-muted)"
npx reactsmith style update "$K#value" --css "font-size: 24px; font-weight: 700; line-height: 32px; letter-spacing: -0.02em; color: var(--color-text)"

npx reactsmith style update "$V#root" --gap 5
npx reactsmith element insert div --into "$V#root" --name stats --direction row --gap 5
npx reactsmith element insert StatCard --into "$V#stats" --props "label='Earnings' value='`$350.4'"
npx reactsmith element insert IconBadge --into "$V#stats/StatCard[1]"
npx reactsmith element insert ChartColumnIcon --into "$V#stats/StatCard[1]/IconBadge"
npx reactsmith element insert StatCard --into "$V#stats" --props "label='Spend this month' value='`$642.39'"
npx reactsmith element insert IconBadge --into "$V#stats/StatCard[2]"
npx reactsmith element insert DollarSignIcon --into "$V#stats/StatCard[2]/IconBadge"
npx reactsmith element insert StatCard --into "$V#stats" --props "label='Sales' value='`$574.34'"
npx reactsmith element insert IconBadge --into "$V#stats/StatCard[3]"
npx reactsmith element insert TrendingUpIcon --into "$V#stats/StatCard[3]/IconBadge"
npx reactsmith element insert StatCard --into "$V#stats" --props "label='Your balance' value='`$1,000'"
npx reactsmith element insert IconBadge --into "$V#stats/StatCard[4]"
npx reactsmith element insert WalletIcon --into "$V#stats/StatCard[4]/IconBadge"
npx reactsmith element insert StatCard --into "$V#stats" --props "label='New Tasks' value='154'"
npx reactsmith element insert IconBadge --into "$V#stats/StatCard[5]"
npx reactsmith element insert CheckIcon --into "$V#stats/StatCard[5]/IconBadge"
npx reactsmith element insert StatCard --into "$V#stats" --props "label='Total Projects' value='2935'"
npx reactsmith element insert IconBadge --into "$V#stats/StatCard[6]"
npx reactsmith element insert FileTextIcon --into "$V#stats/StatCard[6]/IconBadge"

# --- Check table: CHECK_TABLE (feature data) repeated as rows, each with a checkbox
npx reactsmith constant create CHECK_TABLE --feature dashboard --file setup/check-table.json
$CT = "features/dashboard/components/CheckTable/CheckTable.tsx"
$CR = "features/dashboard/components/CheckTableRow/CheckTableRow.tsx"
npx reactsmith component create CheckTableRow --feature dashboard --root tr --interface "name: string; progress: string; quantity: string; date: string; checked: boolean"
npx reactsmith element insert td --into "$CR#root" --name product
npx reactsmith element insert div --into "$CR#product" --name item --direction row --align center --gap 3
npx reactsmith element insert input --into "$CR#item" --props "type='checkbox' defaultChecked={checked}" --name checkbox
npx reactsmith element insert span --into "$CR#item" --text "{name}"
npx reactsmith element insert td --into "$CR#root" --text "{progress}"
npx reactsmith element insert td --into "$CR#root" --text "{quantity}"
npx reactsmith element insert td --into "$CR#root" --text "{date}"
npx reactsmith component create CheckTable --feature dashboard --root Card --root-props "title='Check Table'"
npx reactsmith element insert table --into "$CT#root" --name table
npx reactsmith element insert thead --into "$CT#table"
npx reactsmith element insert tr --into "$CT#table/thead"
npx reactsmith element insert th --into "$CT#table/thead/tr" --text "NAME" --name heading
npx reactsmith element insert th --into "$CT#table/thead/tr" --text "PROGRESS"
npx reactsmith element insert th --into "$CT#table/thead/tr" --text "QUANTITY"
npx reactsmith element insert th --into "$CT#table/thead/tr" --text "DATE"
npx reactsmith element insert tbody --into "$CT#table"
npx reactsmith element insert CheckTableRow --into "$CT#table/tbody" --each CHECK_TABLE --as row --key row.name --props "{...row}"
npx reactsmith style update "$CT#table" --css "width: 100%; border-collapse: separate; border-spacing: 0 17px"
npx reactsmith style update "$CT#heading" --css "padding: 0; font-size: 14px; font-weight: 500; line-height: 24px; text-align: left; color: var(--color-text-muted)"
npx reactsmith style update "$CT#table/thead/tr/th[2]" --name heading --css "text-align: left"
npx reactsmith style update "$CT#table/thead/tr/th[3]" --name heading --css "text-align: left"
npx reactsmith style update "$CT#table/thead/tr/th[4]" --name heading --css "text-align: left"
npx reactsmith style update "$CR#root" --css "font-size: 14px; font-weight: 700; line-height: 24px; color: var(--color-text)"
npx reactsmith style update "$CR#checkbox" --css "width: 18px; height: 18px; margin: 3px; accent-color: var(--color-primary)"

# --- Complex table: status and a progress bar
npx reactsmith constant create COMPLEX_TABLE --feature dashboard --file setup/complex-table.json
$XT = "features/dashboard/components/ComplexTable/ComplexTable.tsx"
$XR = "features/dashboard/components/ComplexTableRow/ComplexTableRow.tsx"
npx reactsmith component create ComplexTableRow --feature dashboard --root tr --interface "name: string; status: string; date: string; progress: number"
npx reactsmith element insert td --into "$XR#root" --text "{name}"
npx reactsmith element insert td --into "$XR#root" --text "{status}"
npx reactsmith element insert td --into "$XR#root" --text "{date}"
npx reactsmith element insert td --into "$XR#root"
npx reactsmith element insert progress --into "$XR#root/td[4]" --props "value={progress} max={100}" --name bar
npx reactsmith component create ComplexTable --feature dashboard --root Card --root-props "title='Complex Table'"
npx reactsmith element insert table --into "$XT#root" --name table
npx reactsmith element insert thead --into "$XT#table"
npx reactsmith element insert tr --into "$XT#table/thead"
npx reactsmith element insert th --into "$XT#table/thead/tr" --text "NAME" --name heading
npx reactsmith element insert th --into "$XT#table/thead/tr" --text "STATUS"
npx reactsmith element insert th --into "$XT#table/thead/tr" --text "DATE"
npx reactsmith element insert th --into "$XT#table/thead/tr" --text "PROGRESS"
npx reactsmith element insert tbody --into "$XT#table"
npx reactsmith element insert ComplexTableRow --into "$XT#table/tbody" --each COMPLEX_TABLE --as row --key row.name --props "{...row}"
npx reactsmith style update "$XT#table" --css "width: 100%; border-collapse: separate; border-spacing: 0 17px"
npx reactsmith style update "$XT#heading" --css "padding: 0 0 6px; border-bottom: 1px solid var(--color-surface); font-size: 14px; font-weight: 500; line-height: 24px; text-align: left; color: var(--color-text-muted)"
npx reactsmith style update "$XT#table/thead/tr/th[2]" --name heading --css "text-align: left"
npx reactsmith style update "$XT#table/thead/tr/th[3]" --name heading --css "text-align: left"
npx reactsmith style update "$XT#table/thead/tr/th[4]" --name heading --css "text-align: left"
npx reactsmith style update "$XR#root" --css "font-size: 14px; font-weight: 700; line-height: 24px; color: var(--color-text)"
npx reactsmith style update "$XR#bar" --css "width: 108px; height: 8px; accent-color: var(--color-primary)"

# --- Tasks: TASKS repeated as items with a checkbox and a drag handle
npx reactsmith constant create TASKS --feature dashboard --file setup/tasks.json
$TL = "features/dashboard/components/TaskList/TaskList.tsx"
$TI = "features/dashboard/components/TaskItem/TaskItem.tsx"
npx reactsmith component create TaskItem --feature dashboard --interface "title: string; done: boolean" --direction row --align center --gap 4
npx reactsmith element insert input --into "$TI#root" --props "type='checkbox' defaultChecked={done}" --name checkbox
npx reactsmith element insert span --into "$TI#root" --text "{title}" --name title
npx reactsmith element insert GripVerticalIcon --into "$TI#root"
npx reactsmith component create TaskList --feature dashboard --root Card --root-props "title='Tasks'"
npx reactsmith element insert TaskItem --into "$TL#root" --each TASKS --as task --key task.title --props "{...task}"
npx reactsmith style update "$TI#root" --css "color: var(--color-text-muted)"
npx reactsmith style update "$TI#checkbox" --css "width: 18px; height: 18px; margin: 3px; accent-color: var(--color-primary)"
npx reactsmith style update "$TI#title" --css "flex: 1; font-size: 16px; font-weight: 700; line-height: 28px; letter-spacing: -0.02em; color: var(--color-text)"

# --- Dashboard rows: the two tables side by side, then the tasks
npx reactsmith element insert div --into "$V#root" --name tables --direction row --align start --gap 5
npx reactsmith element insert CheckTable --into "$V#tables" --name table
npx reactsmith style update "$V#tables/CheckTable" --css "flex: 1"
npx reactsmith element insert ComplexTable --into "$V#tables"
npx reactsmith style update "$V#tables/ComplexTable" --name table --css "flex: 1"
npx reactsmith element insert TaskList --into "$V#root" --name taskList
npx reactsmith style update "$V#taskList" --css "width: 387px"

# --- Verify
npx reactsmith check
npx tsc -b
```

Then run `npm run dev` and open `/`. The other pages (`/nft-marketplace`, `/data-tables`, `/kanban`, `/profile`, `/sign-in`) show their header only.

## 3. Reset to the fresh Vite starter

Removes everything the setup generated and restores the starter files that `init` changed (`src/`, `tsconfig.app.json`, `vite.config.ts`), so step 2 can be run again. The installed packages, [setup/](setup/) and this guide stay. Run from `apps/figma-dashboard`; the whole block can be pasted at once.

```powershell
# --- Remove what the setup generated
Remove-Item -Recurse -Force src, dist, reactsmith.config.json -ErrorAction SilentlyContinue

# --- Get the starter files from a fresh copy of the template, in a temporary folder
$here = Get-Location
$tmp = Join-Path $env:TEMP "figma-dashboard-reset"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Set-Location $env:TEMP
npx create-vite@9.3.1 figma-dashboard-reset --template react-ts --no-interactive --no-immediate
Set-Location $here

# --- Put them back, then delete the temporary folder
Copy-Item -Recurse "$tmp\src" .
Copy-Item "$tmp\tsconfig.app.json", "$tmp\vite.config.ts" .
Remove-Item -Recurse -Force $tmp
```

## Notes

- **Components that take children** (`NavItem`, `StatCard`, `IconBadge`, `Card`) are containers: elements and icons are inserted into their usages, e.g. `element insert WalletIcon --into "$V#stats/StatCard[4]/IconBadge"`. Their children come first in the root, before what is inserted into it later.
- **A component as root**: `CheckTable`, `ComplexTable` and `TaskList` have `Card` as their root (`--root Card --props "title='Check Table'"`), and their rows go inside it.
- **Styling a component where it is used**: `element insert CheckTable --name table` makes `CheckTable` styleable (`className`), and its root `Card` too.
- **One style for several elements**: `style update <element> --name action` gives an element an existing style, as the three toolbar buttons share `action`. `element insert --name` only takes a new name.
- **Checkboxes from data**: `defaultChecked={checked}` shows the state of each row without any condition in the code.
- **Tables** are real tables. The rows are components with a `tr` root (`--root tr`), repeated into the `tbody`. Cells hold text and elements, like the checkbox and the name. Table elements take no layout options, because the table lays them out, so the rows are spaced with `border-spacing`. The commands and `check` refuse content a table can't hold, such as a `span` directly in a `tr`.
- **Changing the data**: edit a file in [setup/](setup/) and run, for example, `npx reactsmith constant update TASKS --feature dashboard --file setup/tasks.json`.

**Not done by the commands.** The first four can be done by hand, as the package [README](../../packages/reactsmith/README.md#changing-things-by-hand) shows:
- **Styling a child from its parent's state**: `--css` takes states (`&:hover`) but no child selectors (`& svg`), so the open page's icon and label are both primary, while Horizon has a navy label. A rule such as `.root[aria-current="page"] .label` can be written in the style file.
- **Variants**: some parts differ per item: Horizon's status icons and colors (Approved, Disable, Error), the muted look of unfinished tasks, the Sales trend line and the gradient "New Tasks" badge. They need conditions in the JSX, or styling by data (`data-status` with attribute selectors in the style file).
- **Icons from data**: a JSON constant can't hold an icon, so the pages and the stat cards are inserted one by one. By hand: an icon name in the data, and a map of names to icons in `utils/`.
- **Fonts and exact colors**: there is no command to set `--font-sans` or load a web font (DM Sans, Poppins). The palette derives the neutral shades from one color, so the page background is lighter than Horizon's `#F4F7FE` and the text is near-black instead of navy `#2B3674`. Both can be overridden in `global.css`.
- **Forms**: a `label` can't hold an `input`, so the search field is a `div`.
- **Layout options**: `--padding` takes one or two steps (`"72px 0 41px"` goes in `--css`), and `component create --gap` has no `none`.
- **Responsiveness**: none, as said above.
