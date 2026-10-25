---
name: ANII Android
description: Native daily planning in ANII’s warm cream and teal identity.
colors:
  cream: "#FFFCF0"
  ink: "#100F0F"
  paper-container: "#F2F0E5"
  teal: "#1D716A"
  selected: "#DDF1E4"
  on-selected: "#124D48"
  muted-ink: "#575653"
  outline: "#878580"
  divider: "#DAD8CE"
  dark-ground: "#100F0F"
  dark-surface: "#1C1B1A"
  dark-container: "#282726"
  dark-ink: "#CECDC3"
  dark-teal: "#3AA99F"
  dark-selected: "#173E3A"
  dark-on-selected: "#BCE5DD"
  dark-muted-ink: "#B7B5AC"
  dark-divider: "#403E3C"
spacing:
  compact: "8dp"
  field-gap: "12dp"
  content: "16dp"
  sheet: "20dp"
  spacious: "24dp"
  connection: "28dp"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.cream}"
  button-primary-dark:
    backgroundColor: "{colors.dark-teal}"
    textColor: "{colors.dark-ground}"
  selected-container:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.on-selected}"
  selected-container-dark:
    backgroundColor: "{colors.dark-selected}"
    textColor: "{colors.dark-on-selected}"
  task-row:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
  task-row-dark:
    backgroundColor: "{colors.dark-ground}"
    textColor: "{colors.dark-ink}"
---

# Design System: ANII Android

## Overview

**Creative North Star: "ANII, native Android"**

ANII’s established warm cream and teal identity, adapted to native Android planning. Compose Material 3 supplies typography, touch controls, sheets, and navigation. Content remains compact and practical, with flat task lists and restrained tonal selection.

This document applies only to the Android app. MainActivity.kt owns its light/dark color mapping; the web design system remains separate. Native defaults are inherited from the installed Compose Material 3 version, not independently redefined here.

**Key Characteristics:**
- Warm neutral grounds; teal actions and selection.
- Native Material typography and controls.
- Flat task rows; tonal containers for selection and overlays.
- System light/dark appearance.

## Colors

Warm neutral surfaces carry the content; teal marks actions and selected state. Frontmatter values are normative. Dark-prefixed tokens replace corresponding light roles when Android uses dark appearance.

### Primary

- **Teal / Dark teal:** primary, secondary, tertiary, surface tint, and current-day text.
- **Selected / Dark selected:** primary, secondary, and tertiary containers, including navigation selection and selected calendar days.
- **On selected / Dark on selected:** foreground for the shared selected-container roles.

### Neutral

- **Cream / Dark ground:** full-window background and task rows; also the foreground on teal controls.
- **Cream / Dark surface:** base Material surface.
- **Paper container / Dark container:** surface variant and medium/high surface containers; weekend calendar cells.
- **Ink / Dark ink:** primary foreground. Inverse surfaces use this foreground color, with ground as their text color.
- **Muted ink / Dark muted ink:** supporting text and surface-variant foreground.
- **Outline:** shared outline color in both themes.
- **Divider / Dark divider:** outline-variant role; task dividers apply 45% opacity.

Error roles retain Material light/dark defaults. They are semantic feedback, not additional brand accents. Low/bright containers use the base surface; lowest uses ground; dim and higher containers use the container tone.

**The Shared Accent Rule.** Primary, secondary, and tertiary roles share teal and the same selected-container pair.

## Typography

The app inherits Compose Material 3 typography without a custom family, weight, size, or tracking override. Native font scaling remains active. No separate display treatment is implemented.

### Hierarchy

- **Headline large:** connection welcome heading.
- **Headline small:** project heading.
- **Title large:** task/action-sheet titles.
- **Title medium:** task groups, project rows, calendar month and selected-day headings.
- **Title small:** attention notices.
- **Body large:** connection explanation and default body content.
- **Body medium / small:** feedback, task support, and explanatory text.
- **Label medium / small:** current profile, weekday headings, and calendar counts.

**The Native Roles Rule.** Use Material typography roles; the app defines no custom font family or type scale.

## Layout

A single-column Scaffold combines the top app bar, current-profile row, content, and bottom navigation. Root screens expose five destinations. Secondary screens use a back action. Lists scroll within available height; list padding reserves space below floating add controls.

The recurring spacing tokens use native density-independent units (`dp`). Main list/calendar edges use content spacing; sheet content and profile information use sheet spacing. Form groups use compact or field-gap spacing. Connection forms use connection spacing, safe-drawing insets, keyboard insets, and scrolling. No custom width breakpoint or tablet layout is implemented.

Calendar days form seven equal-width columns. Day targets have a minimum height of 56dp. Week/month modes change the day count, retaining the same grid and selected-day task list.

## Elevation & Depth

The content system is mostly flat. Task rows use background color and quiet separators. Native Material defaults provide overlay/FAB elevation and tonal surfaces for menus, dialogs, bottom sheets, and navigation; the app declares no custom shadow scale.

**The Flat List Rule.** Task rows sit directly on the background, separated by subdued dividers.

## Shapes

Buttons, chips, outlined fields, floating action buttons, sheets, and dialogs inherit Material 3 shapes. There is no app-defined radius scale. Task rows and calendar cells remain rectangular; recurring content is not enclosed in custom cards.

## Components

### Buttons

Filled Material buttons use primary/on-primary colors. Text buttons handle secondary actions; icon buttons expose concise content descriptions. Connection submission fills the available width and has a minimum height of 52dp. Busy/invalid states disable relevant controls through native component state.

### Chips

Material FilterChip represents backlog filters and calendar week/month choice. Selected chips inherit the shared secondary-container palette; shape, border, focus, and interaction feedback remain native defaults.

### Cards / Containers

Task and project collections use ListItem. Task rows combine a completion checkbox, title, optional metadata, and action menu; completed titles receive a strike-through. Task dividers use a reduced-opacity outline variant. Attention notices use secondary-container surfaces. There is no custom card primitive.

### Inputs / Fields

OutlinedTextField provides labeled entry and search. Search fields span content width; clear-search controls appear when populated. URL entry is single-line with URI keyboard behavior. Field focus, disabled states, and shape inherit Material. Errors appear in semantic error text or an error-container banner.

### Navigation

A native top app bar names the current destination and exposes profile, capture, and settings controls. A bottom NavigationBar labels each root destination; selected indicators use the common selected-container tone. Native vector icons accompany labels. Floating add actions appear on relevant task/project screens.

### Sheets / Dialogs

ModalBottomSheet hosts task actions and schedule/search editors. AlertDialog handles short title entry. Native dismiss, focus, scrim, shape, and animation behavior remain in place; busy operations guard dismissal where implemented.

### Calendar Cells

Selected-day cells use primaryContainer; unselected weekends use surfaceVariant; other cells use background. Today’s date uses primary text. Task counts and the separate selected-day list supply detail without changing the cell structure.

### Feedback / Motion

A full-width progress indicator reflects busy work; SnackbarHost displays messages. Task list item changes use Compose animateItem, with long-press haptics for actions. The app defines no custom duration or easing scale.

## Do's and Don'ts

### Do:
- Do use the full-window themed Surface, including before a server is connected.
- Do use paired foreground/background roles in both system themes.
- Do preserve native labels, icon descriptions, focus behavior, and touch controls.
- Do use native sheets and dialogs for task actions and editing.

### Don't:
- Don't introduce a separate secondary or tertiary accent; all three roles currently share teal.
- Don't replace task rows with decorative elevated cards.
- Don't treat preview CSS, synthesized tonal ramps, or inherited Material defaults as new application tokens.


Evidence: `app/src/main/java/org/anii/app/MainActivity.kt`, `AppUi.kt`, `TasksUi.kt`, and `CalendarUi.kt`. The sidecar contains browser previews of native patterns; they illustrate roles and structure, not pixel-exact Compose rendering.
