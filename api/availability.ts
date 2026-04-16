const slots = [];

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];

  if (!row.is_open || !row.is_bookable) continue;

  const window = rows.slice(i, i + duration);

  // Ensure full duration exists
  if (window.length !== duration) continue;

  const { preferred, minimum } = partySize
    ? computeBayRequirements(partySize)
    : { preferred: 0, minimum: 0 };

  let valid = true;
  let minOpenBays = Infinity;

  for (const block of window) {
    if (!block.is_open || !block.is_bookable) {
      valid = false;
      break;
    }

    minOpenBays = Math.min(minOpenBays, block.bays_open);

    if (partySize && block.bays_open < minimum) {
      valid = false;
      break;
    }
  }

  if (!valid) continue;

  const state = !partySize
    ? minOpenBays <= 0
      ? "full"
      : minOpenBays === 1
      ? "limited"
      : "available"
    : minOpenBays >= preferred
    ? "available"
    : minOpenBays >= minimum
    ? "limited"
    : "full";

  slots.push({
    time_block_id: row.time_block_id,
    slot_key: `${row.time_block_id}:${row.start_time}`,
    start: row.start_time.slice(0, 5),
    end: row.end_time.slice(0, 5),
    open_bays: minOpenBays,
    total_bays: row.total_bays,
    state,
    preferred_bays_required: partySize ? preferred : undefined,
    minimum_bays_required: partySize ? minimum : undefined,
    display_time: row.display_time || row.start_time.slice(0, 5),
    capacity_window: row.capacity_window,
    derived_half_hour: row.derived_half_hour ?? false,
  });
}
