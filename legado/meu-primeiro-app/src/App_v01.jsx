import { useState } from 'react';

function App() {
  const [estaLigado, setEstaLigado] = useState(false);
  
  return (
    <div style={{
      padding: '40px',
      fontFamily: 'sans-serif',
      textAlign: 'center',
      backgroundColor: estaLigado ? '#fff3cd' : '#343a40',
      color: estaLigado ? 'black' : 'white',
      height: '100vh'
    }}>
      <h1>A lâmpada está: {estaLigado ? ' ACESA' : ' APAGADA'}</h1>
      <button
        onClick={() => setEstaLigado(!estaLigado)}
        style={{
          padding: '12px 24px',
          fontSize: '16px',
          fontWeight: 'bold',
          cursor: 'pointer',
          marginTop: '20px'
        }}
      >
        {estaLigado ? 'Apagar Luz' : 'Ligar Luz'}
      </button>
    </div >
  );
}

export default App;