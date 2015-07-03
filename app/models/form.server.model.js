'use strict';

/**
 * Module dependencies.
 */
var mongoose = require('mongoose'),
    FieldSchema = require('./form_field.server.model.js'),
	Schema = mongoose.Schema,
	pdfFiller = require('pdfFiller'),
	_ = require('lodash'),
	config = require('../../config/config'),
	path = require('path'),
	fs = require('fs-extra'),
	async = require('async'),
	Field = mongoose.model('Field', FieldSchema);


/**
 * Form Schema
 */
var FormSchema = new Schema({
	created: {
		type: Date,
		default: Date.now
	},
	lastModified: {
		type: Date,
		default: Date.now
	},
	title: {
		type: String,
		default: '',
		trim: true,
		unique: true,
		required: 'Title cannot be blank'
	},
	description: {
		type: String,
		default: '',
	},
	form_fields: [{type: Schema.Types.Mixed}],

	submissions: [{
		type: Schema.Types.ObjectId,
		ref: 'FormSubmission'
	}],

	admin: {
		type: Schema.Types.ObjectId,
		ref: 'User'
	},

	pdf: {
		type: Schema.Types.Mixed
	},
	pdfFieldMap: {
		type: Schema.Types.Mixed
	},
	hideFooter: {
		type: Boolean,
		default: true,
	},
	isGenerated: {
		type: Boolean,
		default: false,
	},
	isLive: {
		type: Boolean,
		default: true,
	},
	autofillPDFs: {
		type: Boolean,
		default: false,
	},
});

//Delete template PDF of current Form
FormSchema.pre('remove', function (next) {
	if(this.pdf){
		//Delete template form
		fs.unlink(this.pdf.path, function(err){
			if (err) throw err;
		  	console.log('successfully deleted', this.pdf.path);
		});
	}
});

//Create folder for user's pdfs
FormSchema.pre('save', function (next) {
	var newDestination = path.join(config.pdfUploadPath, this.admin.username.replace(/ /g,'')),
		stat = null;

	try {
        stat = fs.statSync(newDestination);
    } catch (err) {
        fs.mkdirSync(newDestination);
    }
    if (stat && !stat.isDirectory()) {
    	console.log('Directory cannot be created');
        next( new Error('Directory cannot be created because an inode of a different type exists at "' + newDestination + '"') );
    }else{
    	next();
    }
});

//Update lastModified and created everytime we save
FormSchema.pre('save', function (next) {
	var now = new Date();
	this.lastModified = now;
	if( !this.created ){
		this.created = now;
	}
	next();
});

//Move PDF to permanent location after new template is uploaded
FormSchema.pre('save', function (next) {

	if(this.pdf){
		var that = this;
		async.series([
			function(callback){
				if(that.isModified('pdf')){
					console.log('about to move PDF');

					var new_filename = that.title.replace(/ /g,'')+'_template.pdf';

				    var newDestination = path.join(config.pdfUploadPath, that.admin.username.replace(/ /g,''), that.title.replace(/ /g,'')),
				    	stat = null;

				    try {
				        stat = fs.statSync(newDestination);
				    } catch (err) {
				        fs.mkdirSync(newDestination);
				    }
				    if (stat && !stat.isDirectory()) {
				    	console.log('Directory '+newDestination+' cannot be created');
				        callback( new Error('Directory cannot be created because an inode of a different type exists at "' + config.pdfUploadPath + '"') );
				    }

					console.log('about to move PDF');

				    fs.move(that.pdf.path, path.join(newDestination, new_filename), function (err) {
						if (err) {
							console.error(err);
							callback( new Error(err.message) );
						}
						that.pdf.path = path.join(newDestination, new_filename);
						that.pdf.name = new_filename;

						console.log('\n\n PDF file:'+that.pdf.name+' successfully moved to: '+that.pdf.path);

						callback(null,null);
					});
				}
				callback(null,null);
			},
			function(callback){
				if(that.isGenerated){
					that.pdf.path = path.join(config.pdfUploadPath, that.admin.username.replace(/ /g,''), that.title.replace(/ /g,''), that.title.replace(/ /g,'')+'_template.pdf');
					that.pdf.name = that.title.replace(/ /g,'')+'_template.pdf';
					var _typeConvMap = {
						'Multiline': 'textarea',
						'Text': 'textfield',
						'Button': 'checkbox',
						'Choice': 'radio',
						'Password': 'password',
						'FileSelect': 'filefield',
						'Radio': 'radio'
					};

					console.log('autogenerating form');
					console.log(that.pdf.path);

					try {
						pdfFiller.generateFieldJson(that.pdf.path, function(_form_fields){

							//Map PDF field names to FormField field names
							for(var i = 0; i < _form_fields.length; i++){
								var field = _form_fields[i];

								//Convert types from FDF to 'FormField' types
								if(_typeConvMap[ field.fieldType+'' ]){
									field.fieldType = _typeConvMap[ field.fieldType+'' ];
								}

								field.fieldValue = '';
								field.created = Date.now();
								field.required = true;
			    				field.disabled  = false;

								// field = new Field(field);
								// field.save(function(err) {
								// 	if (err) {
								// 		console.error(err.message);
								// 		throw new Error(err.message);
								// 		});
								// 	} else {
								// 		_form_fields[i] = that;
								// 	}
								// });
								_form_fields[i] = field;
							}

							console.log('NEW FORM_FIELDS: ');
							console.log(_form_fields);

							console.log('\n\nOLD FORM_FIELDS: ');
							console.log(that.form_fields);

							that.form_fields = _form_fields;
							callback();
						});
					} catch(err){
						next( new Error(err.message) );
					}
				}	
				callback(null,null);
			}
		], function(err, results) {
			if(err){
				next(new Error({
					message: err.message
				}));
			}
			next();
		});
	}
	next();
});

//Autogenerate Form_fields from PDF if 'isGenerated' flag is set
// FormSchema.pre('save', function (next) {
// 	var field, _form_fields; 
	
// 	if(this.pdf){
// 		if(this.isGenerated){

// 			var _typeConvMap = {
// 				'Multiline': 'textarea',
// 				'Text': 'textfield',
// 				'Button': 'checkbox',
// 				'Choice': 'radio',
// 				'Password': 'password',
// 				'FileSelect': 'filefield',
// 				'Radio': 'radio'
// 			};

// 			var that = this;
// 			console.log('autogenerating form');

// 			try {
// 				pdfFiller.generateFieldJson(this.pdf.path, function(_form_fields){

// 					//Map PDF field names to FormField field names
// 					for(var i = 0; i < _form_fields.length; i++){
// 						field = _form_fields[i];

// 						//Convert types from FDF to 'FormField' types
// 						if(_typeConvMap[ field.fieldType+'' ]){
// 							field.fieldType = _typeConvMap[ field.fieldType+'' ];
// 						}

// 						field.fieldValue = '';
// 						field.created = Date.now();
// 						field.required = true;
// 	    				field.disabled  = false;

// 						// field = new Field(field);
// 						// field.save(function(err) {
// 						// 	if (err) {
// 						// 		console.error(err.message);
// 						// 		throw new Error(err.message);
// 						// 		});
// 						// 	} else {
// 						// 		_form_fields[i] = this;
// 						// 	}
// 						// });
// 						_form_fields[i] = field;
// 					}

// 					console.log('NEW FORM_FIELDS: ');
// 					console.log(_form_fields);

// 					console.log('\n\nOLD FORM_FIELDS: ');
// 					console.log(that.form_fields);

// 					that.form_fields = _form_fields;
// 					next();
// 				});
// 			} catch(err){
// 				next( new Error(err.message) );
// 			}
// 		}	
// 	}

// 	next();
// });

FormSchema.methods.convertToFDF = function (cb) {
	var _keys = _.pluck(this.form_fields, 'title'),
		_values = _.pluck(this.form_fields, 'fieldValue');

	_values.forEach(function(val){
		if(val === true){
			val = 'Yes';
		}else if(val === false) {
			val = 'Off';
		}
	});

	var jsonObj = _.zipObject(_keys, _values);

	return jsonObj;
};

mongoose.model('Form', FormSchema);