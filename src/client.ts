import un , { UnResponse }from '@uni-helper/uni-network';
import { Models } from './models';
import { Service } from './service';

type Payload = {
    [key: string]: any;
}

type Headers = {
    [key: string]: string;
}

type RealtimeResponse = {
    type: 'error' | 'event' | 'connected' | 'response';
    data: RealtimeResponseAuthenticated | RealtimeResponseConnected | RealtimeResponseError | RealtimeResponseEvent<unknown>;
}

type RealtimeRequest = {
    type: 'authentication';
    data: RealtimeRequestAuthenticate;
}

export type RealtimeResponseEvent<T extends unknown> = {
    events: string[];
    channels: string[];
    timestamp: number;
    payload: T;
}

type RealtimeResponseError = {
    code: number;
    message: string;
}

type RealtimeResponseConnected = {
    channels: string[];
    user?: object;
}

type RealtimeResponseAuthenticated = {
    to: string;
    success: boolean;
    user: object;
}

type RealtimeRequestAuthenticate = {
    session: string;
}

type Realtime = {
    socket?: WebSocket;
    timeout?: number;
    url?: string;
    lastMessage?: RealtimeResponse;
    channels: Set<string>;
    subscriptions: Map<number, {
        channels: string[];
        callback: (payload: RealtimeResponseEvent<any>) => void
    }>;
    subscriptionsCounter: number;
    reconnect: boolean;
    reconnectAttempts: number;
    getTimeout: () => number;
    connect: () => void;
    createSocket: () => void;
    cleanUp: (channels: string[]) => void;
    onMessage: (event: MessageEvent) => void;
}

export type UploadProgress = {
    $id: string;
    progress: number;
    sizeUploaded: number;
    chunksTotal: number;
    chunksUploaded: number;
}

class AppwriteException extends Error {
    code: number;
    response: string;
    type: string;
    constructor(message: string, code: number = 0, type: string = '', response: string = '') {
        super(message);
        this.name = 'AppwriteException';
        this.message = message;
        this.code = code;
        this.type = type;
        this.response = response;
    }
}

class Client {
    config = {
        endpoint: 'https://HOSTNAME/v1',
        endpointRealtime: '',
        project: '',
        jwt: '',
        locale: '',
    };
    headers: Headers = {
        'x-sdk-name': 'Web',
        'x-sdk-platform': 'client',
        'x-sdk-language': 'web',
        'x-sdk-version': '13.0.0',
        'X-Appwrite-Response-Format': '1.4.0',
    };

    /**
     * Set Endpoint
     *
     * Your project endpoint
     *
     * @param {string} endpoint
     *
     * @returns {this}
     */
    setEndpoint(endpoint: string): this {
        this.config.endpoint = endpoint;
        this.config.endpointRealtime = this.config.endpointRealtime || this.config.endpoint.replace('https://', 'wss://').replace('http://', 'ws://');

        return this;
    }

    /**
     * Set Realtime Endpoint
     *
     * @param {string} endpointRealtime
     *
     * @returns {this}
     */
    setEndpointRealtime(endpointRealtime: string): this {
        this.config.endpointRealtime = endpointRealtime;

        return this;
    }

    /**
     * Set Project
     *
     * Your project ID
     *
     * @param value string
     *
     * @return {this}
     */
    setProject(value: string): this {
        this.headers['X-Appwrite-Project'] = value;
        this.config.project = value;
        return this;
    }

    /**
     * Set JWT
     *
     * Your secret JSON Web Token
     *
     * @param value string
     *
     * @return {this}
     */
    setJWT(value: string): this {
        this.headers['X-Appwrite-JWT'] = value;
        this.config.jwt = value;
        return this;
    }

    /**
     * Set Locale
     *
     * @param value string
     *
     * @return {this}
     */
    setLocale(value: string): this {
        this.headers['X-Appwrite-Locale'] = value;
        this.config.locale = value;
        return this;
    }


    private realtime: Realtime = {
        socket: undefined,
        timeout: undefined,
        url: '',
        channels: new Set(),
        subscriptions: new Map(),
        subscriptionsCounter: 0,
        reconnect: true,
        reconnectAttempts: 0,
        lastMessage: undefined,
        connect: () => {
            clearTimeout(this.realtime.timeout);
            this.realtime.timeout = window?.setTimeout(() => {
                this.realtime.createSocket();
            }, 50);
        },
        getTimeout: () => {
            switch (true) {
                case this.realtime.reconnectAttempts < 5:
                    return 1000;
                case this.realtime.reconnectAttempts < 15:
                    return 5000;
                case this.realtime.reconnectAttempts < 100:
                    return 10_000;
                default:
                    return 60_000;
            }
        },
        createSocket: () => {
            if (this.realtime.channels.size < 1) return;

            const channels = new URLSearchParams();
            channels.set('project', this.config.project);
            this.realtime.channels.forEach(channel => {
                channels.append('channels[]', channel);
            });

            const url = this.config.endpointRealtime + '/realtime?' + channels.toString();

            if (
                url !== this.realtime.url || // Check if URL is present
                !this.realtime.socket || // Check if WebSocket has not been created
                this.realtime.socket?.readyState > WebSocket.OPEN // Check if WebSocket is CLOSING (3) or CLOSED (4)
            ) {
                if (
                    this.realtime.socket &&
                    this.realtime.socket?.readyState < WebSocket.CLOSING // Close WebSocket if it is CONNECTING (0) or OPEN (1)
                ) {
                    this.realtime.reconnect = false;
                    this.realtime.socket.close();
                }

                this.realtime.url = url;
                this.realtime.socket = new WebSocket(url);
                this.realtime.socket.addEventListener('message', this.realtime.onMessage);
                this.realtime.socket.addEventListener('open', _event => {
                    this.realtime.reconnectAttempts = 0;
                });
                this.realtime.socket.addEventListener('close', event => {
                    if (
                        !this.realtime.reconnect ||
                        (
                            this.realtime?.lastMessage?.type === 'error' && // Check if last message was of type error
                            (<RealtimeResponseError>this.realtime?.lastMessage.data).code === 1008 // Check for policy violation 1008
                        )
                    ) {
                        this.realtime.reconnect = true;
                        return;
                    }

                    const timeout = this.realtime.getTimeout();
                    console.error(`Realtime got disconnected. Reconnect will be attempted in ${timeout / 1000} seconds.`, event.reason);

                    setTimeout(() => {
                        this.realtime.reconnectAttempts++;
                        this.realtime.createSocket();
                    }, timeout);
                })
            }
        },
        onMessage: (event) => {
            try {
                const message: RealtimeResponse = JSON.parse(event.data);
                this.realtime.lastMessage = message;
                switch (message.type) {
                    case 'connected':
                        const cookie = JSON.parse(window.localStorage.getItem('cookieFallback') ?? '{}');
                        const session = cookie?.[`a_session_${this.config.project}`];
                        const messageData = <RealtimeResponseConnected>message.data;

                        if (session && !messageData.user) {
                            this.realtime.socket?.send(JSON.stringify(<RealtimeRequest>{
                                type: 'authentication',
                                data: {
                                    session
                                }
                            }));
                        }
                        break;
                    case 'event':
                        let data = <RealtimeResponseEvent<unknown>>message.data;
                        if (data?.channels) {
                            const isSubscribed = data.channels.some(channel => this.realtime.channels.has(channel));
                            if (!isSubscribed) return;
                            this.realtime.subscriptions.forEach(subscription => {
                                if (data.channels.some(channel => subscription.channels.includes(channel))) {
                                    setTimeout(() => subscription.callback(data));
                                }
                            })
                        }
                        break;
                    case 'error':
                        throw message.data;
                    default:
                        break;
                }
            } catch (e) {
                console.error(e);
            }
        },
        cleanUp: channels => {
            this.realtime.channels.forEach(channel => {
                if (channels.includes(channel)) {
                    let found = Array.from(this.realtime.subscriptions).some(([_key, subscription] )=> {
                        return subscription.channels.includes(channel);
                    })

                    if (!found) {
                        this.realtime.channels.delete(channel);
                    }
                }
            })
        }
    }

    /**
     * Subscribes to Appwrite events and passes you the payload in realtime.
     * 
     * @param {string|string[]} channels 
     * Channel to subscribe - pass a single channel as a string or multiple with an array of strings.
     * 
     * Possible channels are:
     * - account
     * - collections
     * - collections.[ID]
     * - collections.[ID].documents
     * - documents
     * - documents.[ID]
     * - files
     * - files.[ID]
     * - executions
     * - executions.[ID]
     * - functions.[ID]
     * - teams
     * - teams.[ID]
     * - memberships
     * - memberships.[ID]
     * @param {(payload: RealtimeMessage) => void} callback Is called on every realtime update.
     * @returns {() => void} Unsubscribes from events.
     */
    subscribe<T extends unknown>(channels: string | string[], callback: (payload: RealtimeResponseEvent<T>) => void): () => void {
        let channelArray = typeof channels === 'string' ? [channels] : channels;
        channelArray.forEach(channel => this.realtime.channels.add(channel));

        const counter = this.realtime.subscriptionsCounter++;
        this.realtime.subscriptions.set(counter, {
            channels: channelArray,
            callback
        });

        this.realtime.connect();

        return () => {
            this.realtime.subscriptions.delete(counter);
            this.realtime.cleanUp(channelArray);
            this.realtime.connect();
        }
    }

    async call(method: string, url: string, headers: Headers = {}, params: Payload = {}): Promise<any> {
        method = method.toUpperCase();
        headers = Object.assign({}, this.headers, headers);
        headers['X-Fallback-Cookies'] = uni.getStorageSync('cookieFallback') ?? '';

        console.log(`${method} - ${url}`);
        console.log(headers);
        console.log(params);

        try {
            if (method === 'GET') {
                const searchParams: { [key: string]: any } = {};
                for (const [key, value] of Object.entries(Service.flatten(params))) {
                    searchParams[key] = value;
                }
                const response = await un.get(url, {params: searchParams, headers: headers});
                return this.handleReponse(response);
            } else {
                switch (headers['content-type']) {
                    case 'application/json': {
                        const response = await un.post(url, {headers: headers, data: params});
                        return this.handleReponse(response);
                    }
                    case 'multipart/form-data': {
                        const response = await un.post(url, {headers: headers, formData: params});
                        return this.handleReponse(response);
                    }
                }
            }
        } catch (e) {
            if (e instanceof AppwriteException) {
                throw e;
            }
            throw new AppwriteException((<Error>e).message);
        }
    }

    handleReponse(response: UnResponse) : any {
        let data = null;
        console.log(response);
        data = response.data;

        console.log(response.headers);
        const cookieFallback = (response?.headers as {
            [x: string]: any
        })['X-Fallback-Cookies'];

        if (cookieFallback) {
            uni.setStorageSync('cookieFallback', cookieFallback);
        }
        return data;
    }
}

export { Client, AppwriteException };
export { Query } from './query';
export type { Models, Payload };
export type { QueryTypes, QueryTypesList } from './query';
