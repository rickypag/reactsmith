---
name: reactsmith-resolver
description: Finds the exact ReactSmith ids and folders a request means, in a React project that has a reactsmith.config.json, before the reactsmith skill turns it into commands. Use when a request describes its targets loosely, by name, visible text, position, file and line, or place, e.g. "the second element in the card", "the button that says Buy", "the Badge from catalog", "ProductCard.tsx:24".
---

# ReactSmith: finding the targets

A request reaches the `reactsmith` skill only with exact targets. Your job is to find them: rewrite the request with every element as an id and every component as its folder, and change nothing else. You only read; you never run a command that writes, and you never judge what the request asks for.

## Exact targets

| Target | Exact form | Example |
| --- | --- | --- |
| Element | the file from `src/`, `#`, then its name or path | `features/homepage/components/ProductCard/ProductCard.tsx#price` |
| Component, view, layout | its folder from `src/` | `features/homepage/components/ProductCard`, `components/buttons/Choice` |
| Feature | its name | `homepage` |

A target already in this form passes through unchanged.

## Finding a component, view or layout

The structure is fixed (`check` keeps it so), and every unit is a folder named after it, holding `<Name>.tsx`:
- **shared components:** `src/components/<type>/<Name>/` (the types are `componentTypes` in reactsmith.config.json);
- **the app's:** `src/app/components/<Name>/`, `src/app/views/<Name>/`, `src/app/layouts/<Name>/`; in a Next.js app (`"framework": "next"`), `src/shell/…` instead, since `src/app` holds Next's pages;
- **a feature's:** `src/features/<feature>/components|views|layouts/<Name>/`.

Search for the folder by name (`src/**/<Name>/<Name>.tsx`). The words of the request narrow it:
- **"shared", "the shared buttons", a type:** `src/components/…`, of that type;
- **"of the app", "the top bar's":** `src/app/…` (`src/shell/…` in a Next.js app);
- **"from homepage", "in the homepage feature":** `src/features/homepage/…`;
- **"the card", "the heading":** match the name loosely (`ProductCard`, `FiltersCard`…), then narrow by place and by what else the request says. Read a file's props when they tell candidates apart.

## Finding an element

1. **Find its file** (above). "In SearchView" is the view's file; "in the card" is the component's.
2. **Read the file's tree:** `./node_modules/.bin/reactsmith tree <file>`. Each line is an element: its tag, its id after `#`, its text in quotes and its props.
   ```
   article #root
     img #image src="{image}" alt="{title}"
     div #content
       div #titleRow
         h3 #title "{title}"
         button #save type="button"
   ```
3. **Match the description** against the tree:
   - **By name:** "the price" → the element named `price`. Names are the most stable: prefer them.
   - **By visible text:** "the button that says Save" → the `button` whose text, or a child's text, is `Save`.
   - **By tag or kind:** "the image", "the heading" → `img`; `h1`…`h6`.
   - **By position:** "the second element in the card" → the second child of `#root`, as the tree lists it, counting from 1. "The last chip" → the last one. Count only what the description counts: "the second button" counts buttons.
   - **By file and line:** `./node_modules/.bin/reactsmith id <file>:<line>` prints the id at that line.
   - **Inside another:** "the title in the title row" → look only under `#titleRow`.
4. **Write the id** as the file from `src/`, `#`, and the element's id from the tree. When it has a name, use the name (`#save`), not its path (`#root/div[1]/div[1]/button[1]`).

A component used in a file is an element of that file: "the ResultsHeading in SearchView" is `…/SearchView.tsx#heading`, not the ResultsHeading folder. Use the folder when the request is about the component itself ("rename the card", "add a prop to the card").

## The answer

Exactly one of:

- **resolved:** the request, with every target exact and every other word as it was:
  ```
  resolved
  In features/homepage/components/ProductCard/ProductCard.tsx#titleRow, add the Badge component from components/badges/Badge with label="New".
  ```
- **candidates:** a target matches more than one thing. List each with what tells them apart (tag, name, text, props, place), and stop:
  ```
  candidates — "the title"
  - features/homepage/components/ProductCard/ProductCard.tsx#title   h3 "{title}"
  - features/homepage/components/ResultsHeading/ResultsHeading.tsx#title   h2 "{title}"
  ```
- **not found:** what you looked for, and where:
  ```
  not found — "the Badge from catalog"
  looked in: src/features/catalog (no such feature), src/components/*/Badge (none)
  ```

## Never guess

When two or more things match, answer with candidates, even if one seems more likely. A wrong target that still works is the worst outcome: the command succeeds, `check` passes, and the change lands in the wrong place.

When you are also the one talking to the person (no other agent called you), give them the candidates and wait for their pick; then pass the resolved request to the `reactsmith` skill.
