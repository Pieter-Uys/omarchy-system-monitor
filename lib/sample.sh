# Sampling for bin/system-monitor: CPU, memory, swap, load, uptime, cores and temperatures.

# Tests point this at a fake sysfs tree; the shell never sets it.
sys=${SYSTEM_MONITOR_SYS:-/sys}

# One awk reads all of /proc, so a refresh costs a single process.
# Cores are counted from /proc/stat, the same CPUs the overall CPU figure covers.
sample() {
  awk '
    FILENAME == "/proc/stat" && FNR == 1 {
      # user nice system idle iowait irq softirq steal (guest time is already in user)
      idle = $5 + $6
      total = 0
      for (i = 2; i <= 9 && i <= NF; i++) total += $i
    }
    FILENAME == "/proc/stat" && /^cpu[0-9]/ { cores++ }
    FILENAME == "/proc/meminfo" && /^MemTotal:/ { mt = $2 }
    FILENAME == "/proc/meminfo" && /^MemAvailable:/ { ma = $2 }
    FILENAME == "/proc/meminfo" && /^SwapTotal:/ { st = $2 }
    FILENAME == "/proc/meminfo" && /^SwapFree:/ { sf = $2 }
    FILENAME == "/proc/loadavg" { l1 = $1; l5 = $2; l15 = $3 }
    FILENAME == "/proc/uptime" { up = int($1) }
    END {
      printf "cpu\t%d\t%d\n", idle, total
      printf "mem\t%d\t%d\nswap\t%d\t%d\n", mt, ma, st, sf
      printf "load\t%s\t%s\t%s\n", l1, l5, l15
      printf "uptime\t%d\n", up
      printf "cores\t%d\n", (cores > 0 ? cores : 1)
    }
  ' /proc/stat /proc/meminfo /proc/loadavg /proc/uptime

  cpu_temp
  [[ ${1:-} == --gpu ]] && gpu_temp
  return 0
}

# Prints "<key>\t<millidegrees>" from a hwmon directory: the first sensor whose label is
# one of the given labels, else temp1. Prints nothing if the reading is missing or garbled.
emit_temp() {
  local key=$1 h=$2 label want f="" value
  shift 2
  for label in "$h"/temp*_label; do
    [[ -r $label ]] || continue
    for want in "$@"; do
      if [[ $(<"$label") == "$want" ]]; then
        f=${label%_label}_input
        break 2
      fi
    done
  done
  [[ -z $f ]] && f=$h/temp1_input
  { value=$(<"$f"); } 2>/dev/null || return 1
  [[ $value =~ ^-?[0-9]{1,7}$ ]] || return 1
  printf '%s\t%d\n' "$key" "$value"
}

cpu_temp() {
  local h
  for h in "$sys"/class/hwmon/hwmon*; do
    [[ -r $h/name ]] || continue
    case $(<"$h/name") in
      k10temp | coretemp | zenpower | cpu_thermal)
        emit_temp cputemp "$h" Tctl Tdie "Package id 0" && return
        ;;
      *) ;;
    esac
  done
}

# True when runtime power management has put the PCI device to sleep.
asleep() {
  local status
  { status=$(<"$1/power/runtime_status"); } 2>/dev/null || return 1
  [[ $status == suspended ]]
}

# The GPU worth watching is the dedicated card, so a machine with both an NVIDIA or AMD card
# and graphics built into its CPU reports the card, not the CPU's graphics. A card that's
# powered down is reported as asleep rather than woken up to be read.
gpu_temp() {
  local dev h name rank vram best="" best_rank=0 best_vram=-1 line awake=""

  # NVIDIA's own driver has no hwmon sensor, so ask nvidia-smi, for a card that's awake only.
  for dev in "$sys"/bus/pci/drivers/nvidia/[0-9a-f]*:*; do
    [[ -e $dev ]] || continue
    if asleep "$dev"; then
      [[ -z $awake ]] && awake=none
    else
      awake=${dev##*/}
      break
    fi
  done
  if [[ $awake == none ]]; then
    printf 'gpusleep\t1\n'
    return
  fi
  if [[ -n $awake ]] && command -v nvidia-smi > /dev/null; then
    line=$(timeout 2 nvidia-smi -i "$awake" --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>/dev/null)
    line=${line%%$'\n'*}
    line=${line//[[:space:]]/}
    if [[ $line =~ ^[0-9]{1,3}$ ]]; then
      printf 'gputemp\t%d\n' "$((line * 1000))"
      return
    fi
  fi
  # An NVIDIA card that couldn't be read shows no reading, rather than the CPU's graphics.
  [[ -n $awake ]] && return

  # Otherwise the hwmon GPU sensors, ranked card first:
  #   nouveau and Intel's xe only drive dedicated cards here.
  #   amdgpu gives only graphics built into the CPU a northbridge voltage (in1, "vddnb"),
  #   however much memory the BIOS sets aside for them. 1 GiB or less of memory also marks
  #   CPU graphics, for kernels from before that sensor.
  #   The older radeon driver shows neither sign, so a radeon GPU ranks lowest.
  # Only amdgpu reports its memory, so it settles ties between amdgpu cards; otherwise the
  # first one listed wins.
  for h in "$sys"/class/hwmon/hwmon*; do
    [[ -r $h/name ]] || continue
    name=$(<"$h/name")
    vram=0
    case $name in
      nouveau | xe) rank=3 ;;
      amdgpu)
        { vram=$(<"$h/device/mem_info_vram_total"); } 2>/dev/null || vram=0
        [[ $vram =~ ^[0-9]{1,20}$ ]] || vram=0
        if [[ -e $h/in1_label ]] || ((vram <= 1073741824)); then rank=1; else rank=2; fi
        ;;
      radeon) rank=0 ;;
      *) continue ;;
    esac
    if ((rank > best_rank || (rank == best_rank && vram > best_vram))); then
      best=$h best_rank=$rank best_vram=$vram
    fi
  done
  [[ -z $best ]] && return
  if asleep "$best/device"; then
    printf 'gpusleep\t1\n'
    return
  fi
  emit_temp gputemp "$best" edge
}
