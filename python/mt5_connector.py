import sys
import json
import time
from datetime import datetime

# Try to import MT5 module with fallback options
MT5_MODULE_TYPE = None
try:
    import MetaTrader5 as mt5
    MT5_MODULE_TYPE = "MetaTrader5"
    print("Using MetaTrader5 module", file=sys.stderr)
except ImportError:
    try:
        import mt5linux as mt5
        MT5_MODULE_TYPE = "mt5linux"
        print("Using mt5linux module", file=sys.stderr)
    except ImportError:
        print("ERROR: Neither MetaTrader5 nor mt5linux module found", file=sys.stderr)
        print("Please install one of them: pip install MetaTrader5 or pip install mt5linux", file=sys.stderr)
        sys.exit(1)

class MT5Connector:
    def __init__(self):
        self.connected = False
        self.mt5_module = mt5
        self.module_type = MT5_MODULE_TYPE
        self.mt5_connection = None  # For mt5linux connection object
        
    def _check_mt5_methods(self):
        """Check which MT5 methods are available in the current module"""
        methods = {
            'initialize': hasattr(self.mt5_module, 'initialize'),
            'login': hasattr(self.mt5_module, 'login'),
            'shutdown': hasattr(self.mt5_module, 'shutdown'),
            'account_info': hasattr(self.mt5_module, 'account_info'),
            'symbol_select': hasattr(self.mt5_module, 'symbol_select'),
            'symbol_info': hasattr(self.mt5_module, 'symbol_info'),
            'symbol_info_tick': hasattr(self.mt5_module, 'symbol_info_tick'),
            'symbols_get': hasattr(self.mt5_module, 'symbols_get'),
            'order_send': hasattr(self.mt5_module, 'order_send'),
            'positions_get': hasattr(self.mt5_module, 'positions_get'),
            'last_error': hasattr(self.mt5_module, 'last_error'),
            'MT5': hasattr(self.mt5_module, 'MT5'),  # mt5linux uses MT5 class
        }
        print(f"Available MT5 methods: {methods}", file=sys.stderr)
        print(f"Module type: {self.module_type}", file=sys.stderr)
        return methods
        
    def connect(self, server, login, password):
        """Establish connection to MT5 with given credentials."""
        try:
            # Check available methods
            methods = self._check_mt5_methods()
            
            if self.module_type == "mt5linux":
                # mt5linux uses a different connection pattern
                if methods['MT5']:
                    # Create MT5 connection object
                    self.mt5_connection = self.mt5_module.MT5(
                        host=server,  # or use appropriate host parameter
                        login=login,
                        password=password,
                        server=server
                    )
                    
                    # Try to connect
                    if hasattr(self.mt5_connection, 'connect'):
                        connected = self.mt5_connection.connect()
                        if not connected:
                            print("mt5linux connection failed", file=sys.stderr)
                            return {"success": False, "error": "mt5linux connection failed"}
                    else:
                        # Some versions may auto-connect on initialization
                        print("mt5linux connection created (auto-connect)", file=sys.stderr)
                else:
                    print("ERROR: MT5 class not found in mt5linux module", file=sys.stderr)
                    return {"success": False, "error": "MT5 class not available in mt5linux"}
            else:
                # Standard MetaTrader5 module connection
                if methods['initialize']:
                    if not self.mt5_module.initialize():
                        error_msg = "MT5 initialization failed"
                        if methods['last_error']:
                            error = self.mt5_module.last_error()
                            error_msg = f"MT5 initialization failed: {error}"
                        print(error_msg, file=sys.stderr)
                        return {"success": False, "error": error_msg}
                else:
                    print("Warning: initialize method not found, attempting login directly", file=sys.stderr)
                
                # Try to login
                if methods['login']:
                    authorized = self.mt5_module.login(login, password=password, server=server)
                    if not authorized:
                        error_msg = "Login failed"
                        if methods['last_error']:
                            error = self.mt5_module.last_error()
                            error_msg = f"Login failed: {error}"
                        print(error_msg, file=sys.stderr)
                        return {"success": False, "error": error_msg}
                else:
                    print("ERROR: login method not found in MT5 module", file=sys.stderr)
                    return {"success": False, "error": "login method not available"}
            
            self.connected = True
            
            # Get account info if available
            account_info = None
            if self.module_type == "mt5linux" and self.mt5_connection:
                if hasattr(self.mt5_connection, 'account_info'):
                    account_info = self.mt5_connection.account_info()
            elif methods['account_info']:
                account_info = self.mt5_module.account_info()
            
            # Check if auto trading is enabled
            if account_info and hasattr(account_info, 'trade_expert') and not account_info.trade_expert:
                print("AutoTrading disabled", file=sys.stderr)
                return {"success": False, "error": "AutoTrading disabled. Enable 'Algo Trading' in MT5"}
            
            account_login = account_info.login if account_info and hasattr(account_info, 'login') else login
            print(f"Connected to MT5, account: {account_login}", file=sys.stderr)
            return {"success": True, "data": {"message": "Connected", "account": account_login}}
            
        except Exception as e:
            print(f"Exception in connect: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def _get_mt5_object(self):
        """Get the appropriate MT5 object based on module type"""
        if self.module_type == "mt5linux" and self.mt5_connection:
            return self.mt5_connection
        return self.mt5_module

    def get_symbols(self):
        """Retrieve available symbols from MT5."""
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            
            mt5_obj = self._get_mt5_object()
            
            if not hasattr(mt5_obj, 'symbols_get'):
                return {"success": False, "error": "symbols_get method not available"}
                
            symbols = mt5_obj.symbols_get() or []
            symbol_names = []
            for symbol in symbols:
                if hasattr(symbol, 'name'):
                    symbol_names.append(symbol.name)
                else:
                    symbol_names.append(str(symbol))
            
            return {"success": True, "data": symbol_names}
        except Exception as e:
            print(f"Exception in get_symbols: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def get_symbol_info(self, symbol):
        """Retrieve detailed information for a specific symbol."""
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            
            mt5_obj = self._get_mt5_object()
            
            if not hasattr(mt5_obj, 'symbol_select') or not hasattr(mt5_obj, 'symbol_info'):
                return {"success": False, "error": "Required symbol methods not available"}
                
            if not mt5_obj.symbol_select(symbol, True):
                print(f"Symbol {symbol} not selected", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not selected"}
            
            info = mt5_obj.symbol_info(symbol)
            if not info:
                print(f"Symbol {symbol} not found", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not found"}
            
            # Safely get attributes with defaults
            stops_level = getattr(info, 'stops_level', 0)
            
            return {"success": True, "data": {
                "name": getattr(info, 'name', symbol),
                "point": getattr(info, 'point', 0.00001),
                "digits": getattr(info, 'digits', 5),
                "spread": getattr(info, 'spread', 0),
                "trade_mode": getattr(info, 'trade_mode', 1),
                "volume_min": getattr(info, 'volume_min', 0.01),
                "volume_max": getattr(info, 'volume_max', 100.0),
                "volume_step": getattr(info, 'volume_step', 0.01),
                "stops_level": stops_level,
                "filling_mode": getattr(info, 'filling_mode', 1)
            }}
        except Exception as e:
            print(f"Exception in get_symbol_info: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def get_price(self, symbol):
        """Retrieve the latest price for a symbol."""
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            
            mt5_obj = self._get_mt5_object()
            
            if not hasattr(mt5_obj, 'symbol_select'):
                return {"success": False, "error": "symbol_select method not available"}
                
            if not mt5_obj.symbol_select(symbol, True):
                print(f"Symbol {symbol} not selected", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not selected"}
            
            time.sleep(0.1)  # Brief delay to ensure data availability
            
            # Try to get tick data
            if hasattr(mt5_obj, 'symbol_info_tick'):
                tick = mt5_obj.symbol_info_tick(symbol)
                if tick:
                    symbol_info = mt5_obj.symbol_info(symbol) if hasattr(mt5_obj, 'symbol_info') else None
                    point = symbol_info.point if symbol_info and hasattr(symbol_info, 'point') and symbol_info.point > 0 else 0.00001
                    spread = (tick.ask - tick.bid) / point if hasattr(tick, 'ask') and hasattr(tick, 'bid') else 0
                    
                    return {"success": True, "data": {
                        "symbol": symbol,
                        "bid": getattr(tick, 'bid', 0),
                        "ask": getattr(tick, 'ask', 0),
                        "spread": spread,
                        "time": datetime.fromtimestamp(getattr(tick, 'time', time.time())).isoformat()
                    }}
            
            # Fallback to rates if tick data not available
            if hasattr(mt5_obj, 'copy_rates_from_pos'):
                # Try to get timeframe constant
                timeframe = getattr(mt5_obj, 'TIMEFRAME_M1', 1)
                rates = mt5_obj.copy_rates_from_pos(symbol, timeframe, 0, 1)
                if rates and len(rates):
                    rate = rates[0]
                    close_price = rate.get('close', 0) if isinstance(rate, dict) else getattr(rate, 'close', 0)
                    rate_time = rate.get('time', time.time()) if isinstance(rate, dict) else getattr(rate, 'time', time.time())
                    
                    return {"success": True, "data": {
                        "symbol": symbol,
                        "bid": close_price,
                        "ask": close_price,
                        "spread": 0,
                        "time": datetime.fromtimestamp(rate_time).isoformat()
                    }}
            
            print(f"No price data available for {symbol}", file=sys.stderr)
            return {"success": False, "error": f"No price data available for {symbol}"}
            
        except Exception as e:
            print(f"Exception in get_price: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def place_trade(self, symbol, volume, order_type, sl_distance=10.0, tp_distance=10.0, comment="", magic=0):
        """Place a trade with the specified parameters."""
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            
            mt5_obj = self._get_mt5_object()
            
            # Check required methods
            required_methods = ['symbol_select', 'symbol_info', 'symbol_info_tick', 'order_send']
            for method in required_methods:
                if not hasattr(mt5_obj, method):
                    return {"success": False, "error": f"Required method {method} not available"}
            
            if not mt5_obj.symbol_select(symbol, True):
                print(f"Symbol {symbol} not selected", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not selected"}
            
            info = mt5_obj.symbol_info(symbol)
            if not info:
                print(f"Symbol {symbol} not found", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not found"}
            
            if getattr(info, 'trade_mode', 1) == 0:
                print(f"Symbol {symbol} not tradable (trade_mode=0)", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not tradable"}

            # Get symbol properties with defaults
            point = getattr(info, 'point', 0.00001)
            digits = getattr(info, 'digits', 5)
            volume_min = getattr(info, 'volume_min', 0.01)
            volume_max = getattr(info, 'volume_max', 100.0)
            volume_step = getattr(info, 'volume_step', 0.01)
            stops_level = getattr(info, 'stops_level', 0) * point
            filling_mode = getattr(info, 'filling_mode', 1)
            
            if sl_distance < stops_level:
                sl_distance = stops_level
            if tp_distance < stops_level:
                tp_distance = stops_level

            tick = mt5_obj.symbol_info_tick(symbol)
            if not tick:
                print(f"No price for {symbol}", file=sys.stderr)
                return {"success": False, "error": f"No price for {symbol}"}
            
            order_type = order_type.upper()
            
            # Get order type constants - try different approaches
            ORDER_TYPE_BUY = getattr(mt5_obj, 'ORDER_TYPE_BUY', 
                                   getattr(self.mt5_module, 'ORDER_TYPE_BUY', 0))
            ORDER_TYPE_SELL = getattr(mt5_obj, 'ORDER_TYPE_SELL', 
                                    getattr(self.mt5_module, 'ORDER_TYPE_SELL', 1))
            
            if order_type == "BUY":
                mt5_type = ORDER_TYPE_BUY
                price = getattr(tick, 'ask', 0)
                sl = round(price - sl_distance, digits)
                tp = round(price + tp_distance, digits)
            elif order_type == "SELL":
                mt5_type = ORDER_TYPE_SELL
                price = getattr(tick, 'bid', 0)
                sl = round(price + sl_distance, digits)
                tp = round(price - tp_distance, digits)
            else:
                print(f"Invalid type {order_type}", file=sys.stderr)
                return {"success": False, "error": f"Invalid type {order_type}"}

            volume = max(volume_min, min(volume_max, round(volume / volume_step) * volume_step))
            
            # Get filling type constants
            ORDER_FILLING_FOK = getattr(mt5_obj, 'ORDER_FILLING_FOK', 
                                      getattr(self.mt5_module, 'ORDER_FILLING_FOK', 0))
            ORDER_FILLING_IOC = getattr(mt5_obj, 'ORDER_FILLING_IOC', 
                                      getattr(self.mt5_module, 'ORDER_FILLING_IOC', 1))
            ORDER_FILLING_RETURN = getattr(mt5_obj, 'ORDER_FILLING_RETURN', 
                                         getattr(self.mt5_module, 'ORDER_FILLING_RETURN', 2))
            
            filling_type = {
                0: ORDER_FILLING_FOK,
                1: ORDER_FILLING_IOC,
                2: ORDER_FILLING_RETURN
            }.get(filling_mode & 0b11, ORDER_FILLING_IOC)

            # Get other constants
            TRADE_ACTION_DEAL = getattr(mt5_obj, 'TRADE_ACTION_DEAL', 
                                      getattr(self.mt5_module, 'TRADE_ACTION_DEAL', 1))
            ORDER_TIME_GTC = getattr(mt5_obj, 'ORDER_TIME_GTC', 
                                   getattr(self.mt5_module, 'ORDER_TIME_GTC', 0))

            request = {
                "action": TRADE_ACTION_DEAL,
                "symbol": symbol,
                "volume": volume,
                "type": mt5_type,
                "price": price,
                "sl": sl,
                "tp": tp,
                "deviation": 20,
                "magic": magic,
                "comment": comment,
                "type_time": ORDER_TIME_GTC,
                "type_filling": filling_type
            }
            
            print(f"Trade request: {json.dumps(request)}", file=sys.stderr)
            result = mt5_obj.order_send(request)
            
            if result is None:
                error_msg = "Order send failed"
                if hasattr(mt5_obj, 'last_error'):
                    error = mt5_obj.last_error()
                    error_msg = f"Order send failed: {error}"
                print(error_msg, file=sys.stderr)
                return {"success": False, "error": error_msg}
            
            # Get return code constant
            TRADE_RETCODE_DONE = getattr(mt5_obj, 'TRADE_RETCODE_DONE', 
                                       getattr(self.mt5_module, 'TRADE_RETCODE_DONE', 10009))
            
            if getattr(result, 'retcode', -1) == TRADE_RETCODE_DONE:
                return {"success": True, "data": {
                    "order": getattr(result, 'order', 0),
                    "deal": getattr(result, 'deal', 0),
                    "volume": getattr(result, 'volume', volume),
                    "price": getattr(result, 'price', price),
                    "sl": sl,
                    "tp": tp,
                    "comment": comment,
                    "retcode": getattr(result, 'retcode', 0)
                }}
            
            retcode = getattr(result, 'retcode', -1)
            error_codes = {
                10018: "Market closed",
                10019: "Insufficient funds",
                10020: "Prices changed",
                10021: "Invalid request (check volume, symbol, or market status)",
                10022: "Invalid SL/TP",
                10017: "Invalid parameters",
                10027: "AutoTrading disabled"
            }
            error_msg = error_codes.get(retcode, f"Error {retcode}")
            print(f"Order failed with retcode {retcode}: {error_msg}", file=sys.stderr)
            return {"success": False, "error": f"Order failed: {error_msg}"}
            
        except Exception as e:
            print(f"Exception in place_trade: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def close_trade(self, ticket, volume, symbol=None, order_type=None, max_retries=3):
        """Close an existing trade with retry logic."""
        try:
            if not self.connected:
                print("Not connected to MT5", file=sys.stderr)
                return {"success": False, "error": "Not connected"}

            mt5_obj = self._get_mt5_object()

            if not hasattr(mt5_obj, 'positions_get'):
                return {"success": False, "error": "positions_get method not available"}

            print(f"Attempting to fetch position for ticket {ticket}", file=sys.stderr)
            position = mt5_obj.positions_get(ticket=ticket)
            if not position:
                print(f"Position {ticket} not found in MT5", file=sys.stderr)
                return {"success": False, "error": f"Position {ticket} not found"}
            pos = position[0]

            symbol = symbol or getattr(pos, 'symbol', '')
            
            # Get position type constants
            POSITION_TYPE_BUY = getattr(mt5_obj, 'POSITION_TYPE_BUY', 
                                      getattr(self.mt5_module, 'POSITION_TYPE_BUY', 0))
            ORDER_TYPE_BUY = getattr(mt5_obj, 'ORDER_TYPE_BUY', 
                                   getattr(self.mt5_module, 'ORDER_TYPE_BUY', 0))
            ORDER_TYPE_SELL = getattr(mt5_obj, 'ORDER_TYPE_SELL', 
                                    getattr(self.mt5_module, 'ORDER_TYPE_SELL', 1))
            
            pos_type = getattr(pos, 'type', 0)
            position_type = "BUY" if pos_type == POSITION_TYPE_BUY else "SELL"
            close_type = ORDER_TYPE_SELL if pos_type == POSITION_TYPE_BUY else ORDER_TYPE_BUY
            position_volume = getattr(pos, 'volume', volume)

            if order_type and order_type.upper() != ("SELL" if position_type == "BUY" else "BUY"):
                print(f"Invalid order type {order_type} for position type {position_type}", file=sys.stderr)
                return {"success": False, "error": f"Invalid order type {order_type} for position type {position_type}"}

            # Get current price
            tick = mt5_obj.symbol_info_tick(symbol)
            if not tick:
                print(f"No price for {symbol}", file=sys.stderr)
                return {"success": False, "error": f"No price for {symbol}"}

            close_price = getattr(tick, 'bid' if position_type == "BUY" else 'ask', 0)
            
            # Get constants
            TRADE_ACTION_DEAL = getattr(mt5_obj, 'TRADE_ACTION_DEAL', 
                                      getattr(self.mt5_module, 'TRADE_ACTION_DEAL', 1))
            ORDER_TIME_GTC = getattr(mt5_obj, 'ORDER_TIME_GTC', 
                                   getattr(self.mt5_module, 'ORDER_TIME_GTC', 0))
            ORDER_FILLING_IOC = getattr(mt5_obj, 'ORDER_FILLING_IOC', 
                                      getattr(self.mt5_module, 'ORDER_FILLING_IOC', 1))

            close_request = {
                "action": TRADE_ACTION_DEAL,
                "symbol": symbol,
                "volume": volume,
                "type": close_type,
                "position": ticket,
                "price": close_price,
                "deviation": 20,
                "magic": getattr(pos, 'magic', 0),
                "comment": f"Close position {ticket}",
                "type_time": ORDER_TIME_GTC,
                "type_filling": ORDER_FILLING_IOC
            }

            print(f"Close request: {json.dumps(close_request)}", file=sys.stderr)
            result = mt5_obj.order_send(close_request)

            if result is None:
                error_msg = "Close order failed"
                if hasattr(mt5_obj, 'last_error'):
                    error = mt5_obj.last_error()
                    error_msg = f"Close order failed: {error}"
                print(error_msg, file=sys.stderr)
                return {"success": False, "error": error_msg}

            TRADE_RETCODE_DONE = getattr(mt5_obj, 'TRADE_RETCODE_DONE', 
                                       getattr(self.mt5_module, 'TRADE_RETCODE_DONE', 10009))

            if getattr(result, 'retcode', -1) == TRADE_RETCODE_DONE:
                return {"success": True, "data": {
                    "order": getattr(result, 'order', 0),
                    "deal": getattr(result, 'deal', 0),
                    "volume": getattr(result, 'volume', volume),
                    "price": getattr(result, 'price', close_price),
                    "retcode": getattr(result, 'retcode', 0)
                }}

            retcode = getattr(result, 'retcode', -1)
            error_codes = {
                10018: "Market closed",
                10019: "Insufficient funds", 
                10020: "Prices changed",
                10021: "Invalid request",
                10022: "Invalid SL/TP",
                10017: "Invalid parameters",
                10027: "AutoTrading disabled"
            }
            error_msg = error_codes.get(retcode, f"Error {retcode}")
            print(f"Close order failed with retcode {retcode}: {error_msg}", file=sys.stderr)
            return {"success": False, "error": f"Close order failed: {error_msg}"}
            
        except Exception as e:
            print(f"Exception in close_trade: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def get_positions(self):
        """Retrieve all open positions."""
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            
            mt5_obj = self._get_mt5_object()
            
            if not hasattr(mt5_obj, 'positions_get'):
                return {"success": False, "error": "positions_get method not available"}
                
            positions = mt5_obj.positions_get() or []
            print(f"Retrieved {len(positions)} positions from MT5", file=sys.stderr)
            
            # Get position type constant
            POSITION_TYPE_BUY = getattr(mt5_obj, 'POSITION_TYPE_BUY', 
                                      getattr(self.mt5_module, 'POSITION_TYPE_BUY', 0))
            
            position_data = []
            for p in positions:
                position_data.append({
                    "ticket": getattr(p, 'ticket', 0),
                    "symbol": getattr(p, 'symbol', ''),
                    "type": "BUY" if getattr(p, 'type', 0) == POSITION_TYPE_BUY else "SELL",
                    "volume": getattr(p, 'volume', 0),
                    "price_open": getattr(p, 'price_open', 0),
                    "price_current": getattr(p, 'price_current', 0),
                    "profit": getattr(p, 'profit', 0),
                    "comment": getattr(p, 'comment', ''),
                    "magic": getattr(p, 'magic', 0)
                })
            
            return {"success": True, "data": position_data}
        except Exception as e:
            print(f"Exception in get_positions: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def disconnect(self):
        """Disconnect from MT5."""
        self.connected = False
        
        if self.module_type == "mt5linux" and self.mt5_connection:
            if hasattr(self.mt5_connection, 'disconnect'):
                self.mt5_connection.disconnect()
            elif hasattr(self.mt5_connection, 'shutdown'):
                self.mt5_connection.shutdown()
        elif hasattr(self.mt5_module, 'shutdown'):
            self.mt5_module.shutdown()
            
        print("MT5 disconnected", file=sys.stderr)
        return {"success": True, "data": "Disconnected"}

def main():
    """Main loop to handle JSON requests from stdin."""
    connector = MT5Connector()
    
    # Print available methods on startup
    print("MT5 Connector starting up...", file=sys.stderr)
    connector._check_mt5_methods()
    
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            request = json.loads(line.strip())
            request_id = request.get('requestId')
            action = request.get('action')
            
            result = {
                'connect': lambda: connector.connect(request['server'], request['login'], request['password']),
                'get_symbols': lambda: connector.get_symbols(),
                'get_symbol_info': lambda: connector.get_symbol_info(request['symbol']),
                'get_price': lambda: connector.get_price(request['symbol']),
                'place_trade': lambda: connector.place_trade(
                    request['symbol'], request['volume'], request['type'],
                    request.get('sl_distance', 10.0), request.get('tp_distance', 10.0),
                    request.get('comment', ''), request.get('magic', 0)
                ),
                'close_trade': lambda: connector.close_trade(
                    request['ticket'], request['volume'],
                    request.get('symbol'), request.get('type')
                ),
                'get_positions': lambda: connector.get_positions(),
                'disconnect': lambda: connector.disconnect()
            }.get(action, lambda: {"success": False, "error": f"Unknown action {action}"})()
            
            result['requestId'] = request_id
            print(json.dumps(result))
            sys.stdout.flush()
            
        except json.JSONDecodeError:
            print(json.dumps({"success": False, "error": "Invalid JSON", "requestId": None}))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e), "requestId": request.get('requestId')}))
            sys.stdout.flush()

if __name__ == "__main__":
    main()