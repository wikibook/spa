/*
  * spa.model.js
  * Model module
  */

/*jslint         browser : true, continue : true,
  devel  : true, indent  : 2,    maxerr   : 50,
  newcap : true, nomen   : true, plusplus : true,
  regexp : true, sloppy  : true, vars     : false,
  white  : true
*/
/*global $, spa */

spa.model = (function () {
	'use strict';
    var
		configMap = { anon_id : 'a0' },
        stateMap  = {
            anon_user      : null,
            cid_serial     : 0,
            is_connected : false,
            people_cid_map : {},
            people_db      : TAFFY(),
            user           : null
        },

    	isFakeData = true,

    	personProto, makeCid, clearPeopleDb, completeLogin,
        makePerson, removePerson, people, chat, initModule;

    // people 객체 API
    // ---------------------
    // people 객체는 spa.model.people에서 사용할 수 있다.
    // people 객체는 사람 객체 컬렉션을 관리하기 위한 메서드 및 이벤트를 제공한다.
    // 이 객체의 공개 메서드는 다음과 같다.
    //  * get_user() - 현재 사용자 사람 객체를 반환. 
    //    현재 사용자가 로그인돼 있지 않으면
    //    익명 사람 객체를 반환.
    //  * get_db() - 미리 정렬돼 있는 모든 사람 객체(현재 사용자 포함)가 있는
    //    TaffyDB 데이터베이스 반환.
    //  * get_by_cid( <client_id> ) - 인자로 전달받은 고유 id에 해당하는 
    //    사람 객체 반환
    //  * login( <user_name> ) - 인자로 받은 사용자명을 사용해 사용자로 로그인.
    //    이때 새 신원을 반영하기 위해 현재 사용자 객체가 변경된다. 
    //    Successful completion of login
    //    publishes a 'spa-login' global custom event.
    //  * logout()- 현재 사용자 객체를 익명으로 되돌림.
    //    people 객체에서 발행하는 제이쿼리 전역 커스텀 이벤트는 다음과 같다.
    //
    // jQuery global custom events published by the object include:
    //  * 'spa-login'은 사용자 로그인 절차가 완료될 때 발행된다.
    //    이때 업데이트된 사용자 객체가 데이터로 제공된다.
    //  * 'spa-logout'는 로그아웃 절차가 완료될 때 발행된다.
    //    이때 이전 사용자 객체가 데이터로 제공된다. 
    //
    // 각 사람은 Person 객체로 표현한다.
    // Person 객체는 다음 메서드를 제공한다.
    //  * get_is_user() - 객체가 현재 사용자이면 true를 반환
    //  * get_is_anon() - 객체가 익명 사용자이면 true를 반환 
    //
    // Person 객체의 속성은 다음과 같다.
    //  * cid - 문자열 클라이언트 id. 이 id는 항상 정의되며,
    //    클라이언트 데이터가 백엔드와 동기화되지
    //    않은 경우에만 id와 일치하지 않는다.
    //  * id - 고유 id. 객체가 백엔드와 동기화되지 않았다면 
    //    정의돼 있지 않을 수 있다.
    //  * name - 사용자의 문자열 이름
    //  * css_map - 아바타 표현에 사용되는 
    //    속성 맵 
    //
	personProto = {
    	get_is_user : function () {
        	return this.cid === stateMap.user.cid;
    	},
    	get_is_anon : function () {
        	return this.cid === stateMap.anon_user.cid;
		} 
	};

    makeCid = function () {
        return 'c' + String( stateMap.cid_serial++ );
    };

    clearPeopleDb = function () {
        var user = stateMap.user;
        stateMap.people_db = TAFFY();
        stateMap.people_cid_map = {};
        if ( user ) {
            stateMap.people_db.insert( user );
            stateMap.people_cid_map[ user.cid ] = user;
        }
    };

    completeLogin = function ( user_list ) {
        var user_map = user_list[ 0 ];
        delete stateMap.people_cid_map[ user_map.cid ]; 
        stateMap.user.cid = user_map._id;
        stateMap.user.id = user_map._id;
        stateMap.user.css_map = user_map.css_map; 
        stateMap.people_cid_map[ user_map._id ] = stateMap.user; 

        // 채팅 기능을 추가할 때 여기서 채팅에 참여하게 해야 한다. 
        $.gevent.publish( 'spa-login', [ stateMap.user ] );
    };

	makePerson = function ( person_map ) {
    	var person,
        	cid 	= person_map.cid,
        	css_map = person_map.css_map,
		    id 		= person_map.id,
    		name 	= person_map.name;
    
    	if ( cid === undefined || ! name ) {
        	throw 'client id and name required';
		}
    
    	person 		   = Object.create( personProto );
    	person.cid 	   = cid;
    	person.name    = name;
    	person.css_map = css_map;
    
    	if ( id ) { person.id = id; }
    	
    	stateMap.people_cid_map[ cid ] = person;
    
    	stateMap.people_db.insert( person );
    	return person;
	};

    removePerson = function ( person ) {
        if ( ! person ) { return false; }
        // 익명인 사람은 제거할 수 없다
        if ( person.id === configMap.anon_id ) {
            return false;
        }

        stateMap.people_db({ cid : person.cid }).remove();
        if ( person.cid ) {
            delete stateMap.people_cid_map[ person.cid ];
        }
        return true;
    };

    people = (function () {
        var get_by_cid, get_db, get_user, login, logout;

        get_by_cid = function ( cid ) {
            return stateMap.people_cid_map[ cid ];
        };

        get_db = function () { return stateMap.people_db; };
        
        get_user = function () { return stateMap.user; };
        
        login = function ( name ) {
            var sio = isFakeData ? spa.fake.mockSio : spa.data.getSio();
            
            stateMap.user = makePerson({
                cid : makeCid(),
                name : name
            });
            sio.on( 'userupdate', completeLogin );
            sio.emit( 'adduser', {
                cid : stateMap.user.cid,
                css_map : stateMap.user.css_map,
                name : stateMap.user.name
            }); 
        };

        people = {
            get_db : function () { return stateMap.people_db; },
            get_cid_map : function () { return stateMap.people_cid_map; }
        };

        logout = function () {
            var is_removed, user = stateMap.user; 
            // 채팅 기능을 추가할 때 여기서 채팅방을 떠나야 한다.
            is_removed = removePerson( user );
            stateMap.user = stateMap.anon_user;
            $.gevent.publish( 'spa-logout', [ user ] );
            return is_removed;
        };

        return {
            get_by_cid : get_by_cid, 
            get_db : get_db, 
            get_user : get_user, 
            login : login,
            logout : logout
        }; 
    }());

    // chat 객체 API
    // -------------------
    // chat 객체는 spa.model.chat에서 사용할 수 있다.
    // chat 객체는 채팅 메시지를 관리하기 위한 메서드 및 이벤트를 제공한다.
    // chat 객체의 public 메서드는 다음과 같다.
    //  * join() - 채팅방에 참여한다. 이 루틴에서는
    //    'spa-listchange' 및 'spa-updatechat' 전역 커스텀 이벤트의 발행자를 비롯해 
    //    백엔드와의 채팅 프로토콜을 설정한다.
    //    현재 사용자가 익명이면
    //    join()은 작업을 중단하고 false를 반환한다.
    // ...
    //
    // chat 객체에서 발송하는 전역 커스텀 이벤트는 다음과 같다.
    // ...
    //  * spa-listchange - 온라인 상태의 사람 목록의 길이가
    //    바뀌거나(즉, 사람이 채팅에 참여하거나 채팅방에서 나갈 때)
    //    내용이 바뀔 때(즉, 사람의 아바타 상세 정보가 변경될 때)
    //    발송된다.
    //    이 이벤트를 구독하는 구독자는 업데이트된 데이터에 대해
    //    people 모델로부터 people_db를 가져와야 한다.
    // ...
    //
    chat = (function () {
        var
            _publish_listchange,
            _update_list, _leave_chat, join_chat; 


        // 내부 메서드 시작
        _update_list = function( arg_list ) {
            var i, person_map, make_person_map,
                people_list = arg_list[ 0 ];
        
            clearPeopleDb();

            PERSON:
            for ( i = 0; i < people_list.length; i++ ) {
                person_map = people_list[ i ];

                if ( ! person_map.name ) { continue PERSON; }

                //사용자가 정의돼 있으면 css_map을 업데이트하고 나머지 코드를 건너뜀 
                if ( stateMap.user && stateMap.user.id === person_map._id ) {
                    stateMap.user.css_map = person_map.css_map;
                    continue PERSON;
                }
            
                make_person_map = {
                    cid : person_map._id,
                    css_map : person_map.css_map,
                    id : person_map._id,
                    name : person_map.name
                };
            
                makePerson( make_person_map );
            }
        
            stateMap.people_db.sort( 'name' );
        };

        _publish_listchange = function ( arg_list ) {
            _update_list( arg_list );
            $.gevent.publish( 'spa-listchange', [ arg_list ] );
        };
        // 내부 메서드 끝

        _leave_chat = function () {
            var sio = isFakeData ? spa.fake.mockSio : spa.data.getSio();
            stateMap.is_connected = false;
            if ( sio ) { sio.emit( 'leavechat' ); }
        };

        join_chat = function () {
            var sio;
    
            if ( stateMap.is_connected ) { return false; }
    
            if ( stateMap.user.get_is_anon() ) {
                console.warn( 'User must be defined before joining chat');
                return false;
            }
    
            sio = isFakeData ? spa.fake.mockSio : spa.data.getSio();
            sio.on( 'listchange', _publish_listchange );
            stateMap.is_connected = true;
            return true;
        };

        return {
            _leave : _leave_chat,
            join : join_chat
        };
    }());

	initModule = function () {
		// 익명 사용자 초기화 
		stateMap.anon_user = makePerson({
        	cid : configMap.anon_id,
        	id : configMap.anon_id,
        	name : 'anonymous'
    	});
    	stateMap.user = stateMap.anon_user;
	};
          
	return {
		initModule : initModule,
        chat : chat,
		people : people
	}; 
}());
