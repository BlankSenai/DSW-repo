function Botao(props) {
    const estiloDoBotao = {
        padding: '10px 20px',
        backgroundColor: props.cor || '#007bff',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        margin: '5px',
        fontSize: '14px',
        fontWeight: 'bold',
    };

    return (<button 
        style={estiloDoBotao}
        onClick={props.action}
    >
        {props.texto}
    </button>)
}

export default Botao