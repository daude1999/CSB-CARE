/** Colours for the three kinds of work on Visits Needing Attention, shared by the queue (client) and the detail panel (server). */
export type QueueType = "unassigned" | "missed" | "comms";

export const TYPE_STYLE: Record<QueueType, { tile: string; chip: string; label: string }> = {
  unassigned: { tile: "bg-[#fdf3d8] text-[#8a5a00]", chip: "bg-[#fdf3d8] text-[#8a5a00]", label: "Unassigned" },
  missed: { tile: "bg-[#fdecec] text-[#b42318]", chip: "bg-[#fdecec] text-[#b42318]", label: "Missed call" },
  comms: { tile: "bg-[#eef4ff] text-[#1d4f91]", chip: "bg-[#eef4ff] text-[#1d4f91]", label: "Communication" },
};
