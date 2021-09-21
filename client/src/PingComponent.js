import { Component } from 'react'
import axios from 'axios'

class PingComponent extends Component {

    constructor() {
        super()
        this.state = {
            pong: 'pending'
        }
    }

    componentWillMount() {
        axios.get('api/ping')
            .then((response) => {
                this.setState(() => {
                    return { pong: response.data.message }
                })
            })
            .catch(function (error) {
                console.log(error)
            })
    }

    render() {
        return (
            <>
                {console.log(this.state)}
                {
                    this.state.pong === '' ?
                        <h1>今回が初回アクセス</h1> :
                        <>
                            <div>前回のアクセスから
                                <div style={{ fontWeight: "bold", fontSize: "2em" }}>{this.state.pong}</div>
                            </div>
                        </>
                }
            </>
        )
    }
}

export default PingComponent