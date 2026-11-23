# Sampling for bin/system-monitor: CPU, memory, swap, load, uptime, cores and temperatures.

sample() {
  # user nice system idle iowait irq softirq steal (guest time is already in user)
  awk 'NR == 1 {
    idle = $5 + $6
    total = 0
    for (i = 2; i <= 9 && i <= NF; i++) total += $i
    printf "cpu\t%d\t%d\n", idle, total
  }' /proc/stat

  awk '
    /^MemTotal:/ { t = $2 }
    /^MemAvailable:/ { a = $2 }
    /^SwapTotal:/ { st = $2 }
    /^SwapFree:/ { sf = $2 }
    END { printf "mem\t%d\t%d\nswap\t%d\t%d\n", t, a, st, sf }
  ' /proc/meminfo

  local l1 l5 l15 rest up
  read -r l1 l5 l15 rest < /proc/loadavg
  printf 'load\t%s\t%s\t%s\n' "$l1" "$l5" "$l15"
  read -r up rest < /proc/uptime
  printf 'uptime\t%d\n' "${up%.*}"
  printf 'cores\t%d\n' "$(nproc 2>/dev/null || echo 1)"

  temps
}

temps() {
  local -A seen=()
  local h name key f label
  for h in /sys/class/hwmon/hwmon*; do
    [[ -r $h/name ]] || continue
    name=$(<"$h/name")
    case $name in
      k10temp | coretemp | zenpower | cpu_thermal) key=cputemp ;;
      amdgpu | radeon | nouveau) key=gputemp ;;
      *) continue ;;
    esac
    [[ -n ${seen[$key]:-} ]] && continue

    # Prefer the package/die sensor; fall back to the first one.
    f=""
    for label in "$h"/temp*_label; do
      [[ -r $label ]] || continue
      case $(<"$label") in
        Tctl | Tdie | "Package id 0" | edge) f=${label%_label}_input; break ;;
      esac
    done
    [[ -z $f ]] && f=$h/temp1_input
    [[ -r $f ]] || continue

    printf '%s\t%d\n' "$key" "$(<"$f")"
    seen[$key]=1
  done
}
