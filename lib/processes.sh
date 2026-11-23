# Process list and process stopping for bin/system-monitor.

# Never offered for stopping, because losing them ends or breaks the desktop session.
# Names are as in /proc/<pid>/comm, which cuts them to 15 characters.
is_protected() {
  case $1 in
    Hyprland | quickshell | Xwayland | systemd | "(sd-pam)" | dbus-* | uwsm* | pipewire* | wireplumber | xdg-desktop-por*) return 0 ;;
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

# True for a live process owned by this user that isn't protected.
is_killable() {
  local comm
  [[ -O /proc/$1 ]] || return 1
  { comm=$(<"/proc/$1/comm"); } 2>/dev/null || return 1
  is_protected "$comm" && return 1
  read_proc_stat "$1" && [[ $proc_state != Z ]]
}

mark_killable() {
  local tag pid cpu mem name
  while IFS=$'\t' read -r tag pid cpu mem name; do
    if is_killable "$pid"; then
      printf '%s\t%s\t%s\t%s\t1\t%s\t%s\n' "$tag" "$pid" "$cpu" "$mem" "$proc_start" "$name"
    else
      printf '%s\t%s\t%s\t%s\t0\t0\t%s\n' "$tag" "$pid" "$cpu" "$mem" "$name"
    fi
  done
}

top_procs() {
  # An empty HOME and XDG_CONFIG_HOME keep a personal toprc from reordering top's columns.
  local cfg
  cfg=$(mktemp -d) || return
  # top's first frame has no time delta (every process reads 0.0), so take a second frame
  # half a second later and keep only that one.
  # top reports 100% per core, so divide by the core count to get a share of the whole CPU,
  # matching the panel's overall meter.
  HOME=$cfg XDG_CONFIG_HOME=$cfg top -b -n2 -d0.5 -w 512 -o %CPU 2>/dev/null | awk -v cores="$(nproc 2>/dev/null || echo 1)" '
    $1 == "PID" { frame++; n = 0; next }
    frame == 2 && NF >= 12 && n < 50 {
      name = $12
      for (i = 13; i <= NF; i++) name = name " " $i
      if (name == "top") next
      printf "proc\t%s\t%.1f\t%s\t%s\n", $1, $9 / (cores > 0 ? cores : 1), $10, name
      n++
    }
  ' | mark_killable
  rm -rf -- "$cfg"
}

# Prints one word: stopped, running, gone, changed or refused.
stop_proc() {
  local pid=${1:-} expected=${2:-} signal=TERM i
  [[ ${3:-} == --force ]] && signal=KILL
  if [[ ! $pid =~ ^[1-9][0-9]{0,9}$ || ! $expected =~ ^[1-9][0-9]{0,19}$ || $# -gt 3 ]]; then
    echo refused
    return
  fi
  if [[ $# -eq 3 && $3 != --force ]]; then
    echo refused
    return
  fi
  if ! read_proc_stat "$pid" || [[ $proc_state == Z ]]; then
    echo gone
    return
  fi
  if [[ $proc_start != "$expected" ]]; then
    echo changed
    return
  fi
  if ! is_killable "$pid" || ! kill -s "$signal" "$pid" 2>/dev/null; then
    echo refused
    return
  fi
  for ((i = 0; i < 20; i++)); do
    if ! read_proc_stat "$pid" || [[ $proc_state == Z || $proc_start != "$expected" ]]; then
      echo stopped
      return
    fi
    sleep 0.1
  done
  echo running
}
