import logo from './logo.svg'
import './App.css'
import PingComponent from './PingComponent'

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Docker を使って React + Go アプリを Heroku にデプロイ
        </p>
        <PingComponent />

      </header>
    </div>
  );
}

export default App;
