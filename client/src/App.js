import logo from './logo.svg'
import './App.css'
import PingComponent from './PingComponent'

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <p>Docker を使って React + Go アプリを Heroku にデプロイ</p>
        <img src={logo} className="App-logo" alt="logo" />
        <PingComponent />

      </header>
    </div>
  );
}

export default App;
