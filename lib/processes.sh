# Process list for bin/system-monitor: the five busiest processes.

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
    frame == 2 && NF >= 12 && n < 5 {
      name = $12
      for (i = 13; i <= NF; i++) name = name " " $i
      if (name == "top") next
      printf "proc\t%s\t%.1f\t%s\t%s\n", $1, $9 / (cores > 0 ? cores : 1), $10, name
      n++
    }
  '
  rm -rf -- "$cfg"
}
