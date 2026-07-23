#!/bin/bash
# 发码接口全流程实测:健康检查→录单→领码→幂等补码→超限拒绝→重置→再领→鉴权拒绝
set -u
cd "$(dirname "$0")/.."
PORT=18787 DATA=$(mktemp -d)
sed "s/PORT: 8787/PORT: $PORT/; s|path.join(__dirname, 'data', 'orders.json')|'$DATA/orders.json'|" fama-server.js > "$DATA/server.js"
node "$DATA/server.js" >/dev/null 2>&1 & SRV=$!
trap "kill $SRV 2>/dev/null; rm -rf $DATA" EXIT
sleep 1
TOKEN="ADMIN-hrdx-7f3a9c-CHANGE-ME"
P=0; F=0
ck(){ if [ "$2" = "$3" ]; then P=$((P+1)); echo "  ✓ $1"; else F=$((F+1)); echo "  ✗ $1 → 得[$2] 应[$3]"; fi; }
J(){ node -e "const d=JSON.parse(process.argv[1]);console.log(eval('d.'+process.argv[2])??'')" "$1" "$2"; }

echo "== 3. 发码接口全流程实测 =="
R=$(curl -s http://127.0.0.1:$PORT/api/health); ck "健康检查" "$(J "$R" ok)" "true"
R=$(curl -s -X POST http://127.0.0.1:$PORT/api/admin/order -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"phone\":\"13800000000\",\"product\":\"hrdx\",\"maxDevices\":1}")
ck "录单成功" "$(J "$R" ok)" "true"
R=$(curl -s -X POST http://127.0.0.1:$PORT/api/claim -H 'Content-Type: application/json' \
  -d '{"phone":"13800000000","product":"hrdx","deviceCode":"AB3F-9C21-77D0"}')
ck "领码成功" "$(J "$R" ok)" "true"
CODE1=$(J "$R" code); ck "码格式 XZ-D-" "${CODE1:0:5}" "XZ-D-"
R=$(curl -s -X POST http://127.0.0.1:$PORT/api/claim -H 'Content-Type: application/json' \
  -d '{"phone":"13800000000","product":"hrdx","deviceCode":"ab3f9c2177d0"}')
ck "同设备再领=原码找回(幂等,归一化大小写)" "$(J "$R" code)" "$CODE1"
R=$(curl -s -X POST http://127.0.0.1:$PORT/api/claim -H 'Content-Type: application/json' \
  -d '{"phone":"13800000000","product":"hrdx","deviceCode":"999988887777"}')
ck "第二台设备被拒(1台上限)" "$(J "$R" ok)" "false"
OID=$(curl -s "http://127.0.0.1:$PORT/api/admin/orders?token=$TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).orders[0].id))")
R=$(curl -s -X POST http://127.0.0.1:$PORT/api/admin/reset -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\",\"id\":\"$OID\"}")
ck "后台重置设备" "$(J "$R" ok)" "true"
R=$(curl -s -X POST http://127.0.0.1:$PORT/api/claim -H 'Content-Type: application/json' \
  -d '{"phone":"13800000000","product":"hrdx","deviceCode":"999988887777"}')
ck "重置后新设备可领" "$(J "$R" ok)" "true"
R=$(curl -s "http://127.0.0.1:$PORT/api/admin/orders?token=WRONG"); ck "错误口令被拒" "$(J "$R" ok)" "false"
R=$(curl -s -X POST http://127.0.0.1:$PORT/api/claim -H 'Content-Type: application/json' \
  -d '{"phone":"13900000000","product":"hrdx","deviceCode":"AB3F9C2177D0"}')
ck "未登记手机号被拒" "$(J "$R" ok)" "false"
R=$(curl -s -X POST http://127.0.0.1:$PORT/api/admin/gcode -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\",\"product\":\"hrdx\"}")
ck "G码生成" "$(J "$R" ok)" "true"

echo "== 汇总 =="; echo "通过 $P / 失败 $F"
[ $F -eq 0 ] && echo "全绿 ✓" || exit 1
