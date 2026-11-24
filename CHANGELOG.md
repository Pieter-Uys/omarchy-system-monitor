# Changelog

## 1.0.0

First release.

- CPU and memory in the bar, or CPU, memory or CPU temperature alone, or just an icon. Right-click or use `cycleLabel` to switch.
- A detail panel with CPU, memory, swap, CPU temperature and GPU temperature meters, load average, core count and uptime.
- The 50 busiest processes, with a confirmed **Stop** and, while a process shuts down, an explicit **Force kill**.
- Processes the desktop session depends on, such as Hyprland, `start-hyprland`, the shell, `hyprlock` and the GNOME keyring, can't be stopped from the panel.
- With a graphics card, the GPU temperature is the card's, including NVIDIA cards on NVIDIA's own driver (read with `nvidia-smi`), rather than the graphics built into the CPU. A powered-down card shows as **Asleep** and is never woken up to be read.
- Everything is read locally from `/proc`, `/sys`, `top` and `nvidia-smi`. No network access.
