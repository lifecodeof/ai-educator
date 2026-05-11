import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import ControlPage from "./ControlPage.tsx"

const isControlPage = window.location.pathname === "/control"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isControlPage ? <ControlPage /> : <App />}
  </StrictMode>,
)
