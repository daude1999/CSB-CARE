/** Colours for the kinds of work on Visits Needing Attention, shared by the queue (client) and the detail panel (server). */
export type QueueType = "unassigned" | "absent" | "missed" | "problem" | "comms";

export const TYPE_STYLE: Record<QueueType, { tile: string; chip: string; label: string }> = {
  unassigned: { tile: "bg-[#fdf3d8] text-[#8a5a00]", chip: "bg-[#fdf3d8] text-[#8a5a00]", label: "Unassigned" },
  absent: { tile: "bg-[#f4ebff] text-[#5b2bb5]", chip: "bg-[#f4ebff] text-[#5b2bb5]", label: "Carer off" },
  problem: { tile: "bg-[#fff1e6] text-[#9a3412]", chip: "bg-[#fff1e6] text-[#9a3412]", label: "Visit problem" },
  missed: { tile: "bg-[#fdecec] text-[#b42318]", chip: "bg-[#fdecec] text-[#b42318]", label: "Missed call" },
  comms: { tile: "bg-[#eef4ff] text-[#1d4f91]", chip: "bg-[#eef4ff] text-[#1d4f91]", label: "Communication" },
};
