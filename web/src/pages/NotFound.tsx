import { Link } from "react-router-dom";

function NotFound() {
  return (
    <div>
      <h1>404 — Page not found</h1>
      <Link to="/">Go home</Link>
    </div>
  );
}

export default NotFound;
