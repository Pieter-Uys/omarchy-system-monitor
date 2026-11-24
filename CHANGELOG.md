# Changelog

## Unreleased

- On a machine with an AMD card and AMD graphics built into the CPU, the GPU temperature is now the card's even when the BIOS gives the CPU's graphics more memory than the card has. Built-in graphics are now recognised by the sensor only they have, not by memory size.

## 1.0.0

First release.

- CPU and memory in the bar, or CPU, memory or CPU temperature alone, or just an icon. Right-click or use `cycleLabel` to switch.
- A detail panel with CPU, memory, swap, CPU temperature and GPU temperature meters, load average, core count and uptime.
- The 50 busiest processes. Each one that's safe to stop has a button in the **Stop** column, with a confirmed **Stop** and, while a process shuts down, an explicit **Force kill**.
- Processes the desktop session depends on, such as Hyprland, `start-hyprland`, the shell, `hyprlock` and the GNOME keyring, can't be stopped from the panel.
- With a graphics card, the GPU temperature is the card's, including NVIDIA cards on NVIDIA's own driver (read with `nvidia-smi`), rather than the graphics built into the CPU. A powered-down card shows as **Asleep** and is never woken up to be read.
- Everything is read locally from `/proc`, `/sys`, `top` and `nvidia-smi`. No network access.

After installing or updating, restart the shell (`omarchy restart shell`) so it loads the new panel. Until then the shell keeps the panel it already had loaded, and the GPU temperature doesn't appear.
