# System Stats

An Omarchy shell bar widget that shows CPU and memory usage with their icons
(or a single reading next to a chip icon), with a panel of detailed readings:

- CPU, memory, swap, CPU temperature and GPU temperature meters (tinted as they run hot)
- Load average, core count and uptime
- A scrollable list of the 50 busiest processes (refreshed while the panel is open)
- Hover a process to stop it, with a confirmation. Force kill is offered only if it keeps running.
  System processes and critical desktop processes such as Hyprland have no stop button.

**Click** opens the panel. **Right-click** cycles the bar reading:
CPU + Memory → CPU → Memory → Temperature → Icon only.

## Install

On a new Omarchy install:

```bash
omarchy plugin add https://github.com/Pieter-Uys/omarchy-system-monitor.git --enable
```

Choose the `right` section when asked. To get later changes:

```bash
omarchy plugin update system-monitor
```

## Settings

| Key | Values | Default |
|---|---|---|
| `barLabel` | `CPU + Memory`, `CPU`, `Memory`, `Temperature`, `Icon only` | `CPU + Memory` |
| `refreshIntervalSec` | 1–60 | 3 |

## IPC

```bash
omarchy-shell system-monitor toggle
omarchy-shell system-monitor cycleLabel
```

## Privacy

Everything is read locally by `bin/system-monitor` from `/proc`, `/sys/class/hwmon`
and `top`. The plugin makes no network requests and writes no files. It only signals a
process after you confirm, and only processes owned by your user.

## Tests

```bash
node --test ~/.config/omarchy/plugins/system-monitor/tests/
```
