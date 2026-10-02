import AppRouter from "../routing/AppRouter.jsx";
import AppBootstrapProvider from "./AppBootstrapProvider.jsx";

export default function App() {
  return (
    <AppBootstrapProvider>
      <AppRouter />
    </AppBootstrapProvider>
  );
}