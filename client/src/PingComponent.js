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
                {
                    this.state.pong === null ||
                        this.state.pong === this.state.pong ||
                        hoge === '' ?
                        <h1>今回が初回アクセス</h1> :
                        <>
                            <p>前回のアクセスから</p>
                            <h1>{this.state.pong}</h1>
                        </>
                }
            </>
        )
    }
}

export default PingComponent