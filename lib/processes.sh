# Process list and process stopping for bin/system-monitor.

# Never offered for stopping, because losing them ends or breaks the desktop session,
# unlocks or disables the lock screen, or loses saved secrets for the session.
# Names are as in /proc/<pid>/comm, which cuts them to 15 characters.
# This guards against a mistaken click, not against a hostile process: any program can
# give itself one of these names, and then it can't be stopped from the panel.
is_protected() {
  case $1 in
    Hyprland | start-hyprland | quickshell | Xwayland | systemd | "(sd-pam)" | dbus-* | uwsm* | \
      pipewire* | wireplumber | xdg-desktop-por* | hyprlock | hypridle | gnome-keyring-d) return 0 ;;
  esac
  return 1
}

# Sets proc_state and proc_start. The start time tells a process from a later one that reuses its PID.
read_proc_stat() {
  local stat fields
  { stat=$(<"/proc/$1/stat"); } 2>/dev/null || return 1
  # The name in field 2 can hold spaces and brackets, so split after its last ") ".
  read -ra fields <<< "${stat##*) }"
  proc_state=${fields[0]:-}
  proc_start=${fields[19]:-}
  [[ -n $proc_state && -n $proc_start ]]
}

# True if <pid> is still running and is the process that started at <start>, not a later
# one that reused its PID.
is_same_process() {
  local pid=$1 start=$2
  read_proc_stat "$pid" && [[ $proc_state != Z && $proc_start == "$start" ]]
}

# True for a live process owned by this user that isn't protected.
is_killable() {
  local comm
  [[ -O /proc/$1 ]] || return 1
  { comm=$(<"/proc/$1/comm"); } 2>/dev/null || return 1
  is_protected "$comm" && return 1
  read_proc_stat "$1" && [[ $proc_state != Z ]]
}

# Sets proc_mem to a process's memory in KiB, or 0 if it can't be read.
# For one of your processes that shares its name with others ($2 is 1), this is the
# proportional set size (Pss), which splits memory shared between processes among them, so a
# browser's dozens of processes add up to what closing it would free. Pss is costly to read
# for a process with a lot of memory mapped (a game can take a tenth of a second), and a
# process alone under its name has little to share, so everything else reads resident memory
# from statm. Sets a variable rather than printing, so a long list costs no subshells.
read_mem() {
  local pid=$1 shared=$2 key value rest statm fields
  proc_mem=0
  if [[ $shared == 1 && -O /proc/$pid ]]; then
    while read -r key value rest; do
      if [[ $key == Pss: ]]; then
        [[ $value =~ ^[0-9]{1,15}$ ]] && proc_mem=$value && return
        break
      fi
    done 2>/dev/null < "/proc/$pid/smaps_rollup"
  fi
  { statm=$(<"/proc/$pid/statm"); } 2>/dev/null || return
  read -ra fields <<< "$statm"
  [[ ${fields[1]:-} =~ ^[0-9]{1,15}$ ]] && proc_mem=$((fields[1] * page_kb))
}

# Adds each process's memory (KiB) and whether it can be stopped.
mark_killable() {
  local tag pid cpu multi name
  page_kb=$(($(getconf PAGESIZE 2>/dev/null || echo 4096) / 1024))
  ((page_kb > 0)) || page_kb=4
  while IFS=$'\t' read -r tag pid cpu multi name; do
    read_mem "$pid" "$multi"
    if is_killable "$pid"; then
      printf '%s\t%s\t%s\t%s\t1\t%s\t%s\n' "$tag" "$pid" "$cpu" "$proc_mem" "$proc_start" "$name"
    else
      printf '%s\t%s\t%s\t%s\t0\t0\t%s\n' "$tag" "$pid" "$cpu" "$proc_mem" "$name"
    fi
  done
}

top_procs() {
  # An empty HOME and XDG_CONFIG_HOME keep a personal toprc from reordering top's columns.
  local cfg
  cfg=$(mktemp -d) || return
  # Every process is listed, not just the busiest, so the panel can add up each program's
  # processes. The panel does the grouping and keeps only the top few.
  # top's first frame has no time delta (every process reads 0.0), so take a second frame
  # half a second later and keep only that one.
  # top reports 100% per core, so divide by the core count to get a share of the whole CPU,
  # matching the panel's overall meter, which covers the same CPUs listed in /proc/stat.
  HOME=$cfg XDG_CONFIG_HOME=$cfg top -b -n2 -d0.5 -w 512 -o %CPU 2>/dev/null | awk '
    NR == FNR { if ($1 ~ /^cpu[0-9]/) cores++; next }
    $1 == "PID" { frame++; n = 0; next }
    frame == 2 && NF >= 12 && n < 4000 {
      name = $12
      for (i = 13; i <= NF; i++) name = name " " $i
      if (name == "top") next
      n++
      pid[n] = $1; cpu[n] = $9 / (cores > 0 ? cores : 1); comm[n] = name; seen[name]++
    }
    # Printed at the end, once each name is known to be shared or not.
    END {
      for (i = 1; i <= n; i++) printf "proc\t%s\t%.1f\t%d\t%s\n", pid[i], cpu[i], (seen[comm[i]] > 1), comm[i]
    }
  ' /proc/stat - | mark_killable
  rm -rf -- "$cfg"
}

# Signals each <pid> <start> pair, so one confirmation can stop every process of a program.
# Returns straight away and prints one word: sent if any process was signalled, refused if
# a running one couldn't be, otherwise gone (all had already exited or had their PID reused).
# Any malformed argument refuses the whole request before anything is signalled.
stop_proc() {
  local signal=TERM args=("$@") i sent=0 failed=0
  if [[ ${args[-1]:-} == --force ]]; then
    signal=KILL
    unset 'args[-1]'
  fi
  if ((${#args[@]} == 0 || ${#args[@]} % 2 != 0 || ${#args[@]} > 8000)); then
    echo refused
    return
  fi
  for ((i = 0; i < ${#args[@]}; i += 2)); do
    if [[ ! ${args[i]} =~ ^[1-9][0-9]{0,9}$ || ! ${args[i + 1]} =~ ^[1-9][0-9]{0,19}$ ]]; then
      echo refused
      return
    fi
  done
  for ((i = 0; i < ${#args[@]}; i += 2)); do
    is_same_process "${args[i]}" "${args[i + 1]}" || continue
    if is_killable "${args[i]}" && kill -s "$signal" "${args[i]}" 2>/dev/null; then
      ((sent++))
    else
      ((failed++))
    fi
  done
  if ((sent > 0)); then
    echo sent
  elif ((failed > 0)); then
    echo refused
  else
    echo gone
  fi
}

# For each <pid> <start> pair still running, prints: alive <pid>. Always ends with ok,
# so a failed check can't be mistaken for every process having exited.
check_procs() {
  while (($# >= 2)); do
    if [[ $1 =~ ^[1-9][0-9]{0,9}$ && $2 =~ ^[1-9][0-9]{0,19}$ ]] && is_same_process "$1" "$2"; then
      printf 'alive\t%s\n' "$1"
    fi
    shift 2
  done
  echo ok
}
