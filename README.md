<div align="center">

# System Stats

**CPU, memory and temperature at a glance, right in your Omarchy bar.**

![Omarchy](https://img.shields.io/badge/Omarchy-shell%20bar%20widget-5e81ac?style=flat-square)
[![Tests](https://img.shields.io/github/actions/workflow/status/Pieter-Uys/omarchy-system-monitor/test.yml?branch=main&label=tests&style=flat-square)](https://github.com/Pieter-Uys/omarchy-system-monitor/actions/workflows/test.yml)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Network](https://img.shields.io/badge/network%20requests-none-lightgrey?style=flat-square)

[Install](#install) · [Usage](#usage) · [Settings](#settings) · [IPC](#ipc) · [Privacy](#privacy) · [Tests](#tests)

![System Stats in the bar, with its panel open: CPU, GPU, memory and swap meters, and the heaviest programs](preview.png)

</div>

---

An Omarchy shell bar widget that shows CPU and memory usage with their icons (or a single reading next to a chip icon), plus a panel of detailed readings.

## Features

| | |
|---|---|
| **Meters** | CPU, GPU, memory and swap, with the CPU and GPU temperature beside their names (`CPU · 58°C`). Each meter tints when its load or temperature runs hot. With a graphics card, the GPU reading is the card's, not the graphics built into the CPU |
| **System info** | Load average, core count and uptime |
| **Program list** | The 12 heaviest programs, with each program's processes added up into one row (`brave ×33 · 5.9 GiB`). Click the **CPU** or **Memory** heading to sort by it; memory is the default. Refreshed while the panel is open |
| **Open btop** | A link at the bottom of the panel opens `btop`, or brings it forward if it's already open |
| **Safe process control** | Programs that are safe to stop have a stop button, with a confirmation step. Stopping a program stops all of its processes |

### Process control

- Stopping a program asks for confirmation first, and covers every process listed under its name.
- While a program shuts down, its row shows how long it has been stopping and a **Force kill** button, which targets only the processes still running.
- Nothing is ever force-killed automatically.
- A program with any process you can't stop has no stop button. That includes system processes and the processes the desktop session depends on: Hyprland and `start-hyprland`, the shell, Xwayland, `systemd`, D-Bus, UWSM, PipeWire and WirePlumber, the desktop portals, `hyprlock`, `hypridle` and the GNOME keyring.
- That list guards against a mistaken click, not against a hostile program: protection goes by process name, and any program can give itself one of those names.

## Usage

| Action | Result |
|---|---|
| **Click** | Opens the detail panel |
| **Right-click** | Cycles the bar reading |

The bar reading cycles in this order:

```
CPU + Memory  →  CPU  →  Memory  →  Temperature  →  Icon only
```

## Install

On a new Omarchy install:

```bash
omarchy plugin add https://github.com/Pieter-Uys/omarchy-system-monitor.git --enable
```

**Requirements:** only `bash`, `awk`, `top` (procps-ng) and coreutils, which every Omarchy install already has. With an NVIDIA card on NVIDIA's own driver, the GPU temperature also needs `nvidia-smi`, which comes with the driver (`nvidia-utils`).

Choose the `right` section when asked, or move it later:

```bash
omarchy bar move io.github.pieter-uys.system-monitor --section right
```

<details>
<summary><b>Update or remove</b></summary>

<br>

Get later changes:

```bash
omarchy plugin update io.github.pieter-uys.system-monitor
```

Remove the plugin:

```bash
omarchy plugin remove io.github.pieter-uys.system-monitor
```

</details>

## Settings

| Key | Values | Default |
|---|---|---|
| `barLabel` | `CPU + Memory`, `CPU`, `Memory`, `Temperature`, `Icon only` | `CPU + Memory` |
| `refreshIntervalSec` | 1 to 60 | `3` |

<details>
<summary><b>Supported temperature sensors</b></summary>

<br>

| Reading | Sensors |
|---|---|
| CPU | AMD (`k10temp`, `zenpower`), Intel (`coretemp`) and Raspberry Pi (`cpu_thermal`). The package or die sensor is preferred |
| GPU | NVIDIA on NVIDIA's driver (through `nvidia-smi`), NVIDIA on `nouveau`, AMD (`amdgpu`, `radeon`) and Intel Arc on `xe` |
| GPU load | NVIDIA on NVIDIA's driver (from the same `nvidia-smi` call) and AMD on `amdgpu` (`gpu_busy_percent`). Elsewhere the GPU meter shows the temperature instead |

- When a machine has both a graphics card and graphics built into the CPU, the card is reported.
- A card that has powered itself down (common on laptops) shows as **Asleep**. It is never woken up just to be read.
- The GPU is only read while the panel is open, because that is the only place its temperature appears.
- A reading that is missing or can't be read is left out rather than shown as 0°.
- Without a recognised sensor, that meter is hidden, and the bar's **Temperature** reading shows a dash.

</details>

## IPC

Control the widget from the command line or from keybindings:

```bash
omarchy-shell io.github.pieter-uys.system-monitor toggle
omarchy-shell io.github.pieter-uys.system-monitor cycleLabel
```

| Command | Description |
|---|---|
| `toggle` | Open or close the detail panel |
| `open`, `show` | Open the detail panel |
| `close`, `hide` | Close the detail panel |
| `cycleLabel` | Advance to the next bar reading |

## Privacy

> Everything stays on your machine.

- All data is read locally by `bin/system-monitor` from `/proc`, `/sys` and `top`, plus `nvidia-smi` for an NVIDIA card while the panel is open.
- The plugin makes **no network requests** and writes no files of its own. Right-clicking saves your chosen bar reading in `shell.json` through the shell's normal widget settings.
- It only signals a process after you confirm, and only processes owned by your user.

## Tests

From a clone of this repository (needs Node.js 20 or later, on Linux):

```bash
node --test tests/*.test.js
```

Or against the installed copy:

```bash
node --test ~/.config/omarchy/plugins/io.github.pieter-uys.system-monitor/tests/*.test.js
```

The tests run the real helper script, so they start and stop a few `sleep` processes of their own. They never touch other processes. The same tests and `shellcheck` run on every push.

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
