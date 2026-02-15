import { Link, Routes, Route } from "react-router-dom";
import ImageToImage from "./pages/ImageToImage";
import ImageToVideo from "./pages/ImageToVideo";
import "./App.css";

function App() {
  return (
    <>
      <nav className="nav">
        <Link to="/">Image to Image</Link>
        <Link to="/image-to-video">Image to Video</Link>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<ImageToImage />} />
          <Route path="/image-to-video" element={<ImageToVideo />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
