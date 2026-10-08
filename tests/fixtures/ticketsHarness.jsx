import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { TicketsContent } from "../../src/components/profile/MyTickets.jsx";

export default function Fixture({ initialOrders }) {
  const [orders, setOrders] = useState(initialOrders);
  const [group, setGroup] = useState("upcoming");
  useEffect(() => {
    window.ticketsRenderingQa = { setOrders };
    return () => { delete window.ticketsRenderingQa; };
  }, []);
  return <TicketsContent read={{ status: "success", data: orders }} group={group} onSelectGroup={setGroup} identity={{ reference: initialOrders[0].reference }} />;
}

const container = document.getElementById("tickets-key-fixture");
if (container) {
  const root = createRoot(container);
  root.render(<MemoryRouter><Fixture initialOrders={window.ticketsFixtureOrders} /></MemoryRouter>);
  window.disposeTicketsRendering = () => root.unmount();
}
